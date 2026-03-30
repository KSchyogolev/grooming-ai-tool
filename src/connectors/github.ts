import { analyzeComplexity, extractImports } from "../lib/code-analysis";
import * as log from "../logger";
import type {
  FileAnalysis,
  GithubDiff,
  GithubFileContent,
  GithubSearchResult,
  OwnershipEntry,
} from "../types";

export interface GithubConnectorConfig {
  token: string;
  repo: string;
}

let _ghConfig: GithubConnectorConfig | null = null;

export function initGithub(config: GithubConnectorConfig): void {
  _ghConfig = config;
}

function getConfig(): GithubConnectorConfig {
  if (!_ghConfig) throw new Error("GitHub connector not initialized — call initGithub() first");
  return _ghConfig;
}

export function getDefaultRepo(): string {
  return getConfig().repo;
}

function getHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${getConfig().token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

/** Per-run file content cache — avoids re-fetching the same file via GitHub API */
const fileContentCache = new Map<string, string>();

export function clearFileCache(): void {
  fileContentCache.clear();
}

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000];

async function ghFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const merged = {
    ...options,
    headers: { ...getHeaders(), ...options?.headers },
    signal: AbortSignal.timeout(30_000),
  };

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url, merged);

    if (res.ok) return res.json() as Promise<T>;

    // Retry on rate limit or server errors
    if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
      const delay = RETRY_DELAYS[attempt] ?? 4000;
      log.warn("GitHub API retry", { status: res.status, url, attempt: attempt + 1 });
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }

    const text = await res.text();
    throw new Error(`GitHub ${res.status}: ${url}\n${text}`);
  }

  throw new Error(`GitHub: max retries exceeded for ${url}`);
}

/** Fetch file content with caching — avoids duplicate reads within a single run */
async function fetchFileContent(filePath: string, repo: string, ref: string): Promise<string> {
  const cacheKey = `${repo}:${ref}:${filePath}`;
  const cached = fileContentCache.get(cacheKey);
  if (cached) return cached;

  const data = await ghFetch<{ content: string }>(
    `https://api.github.com/repos/${repo}/contents/${filePath}?ref=${ref}`,
  );
  const content = Buffer.from(data.content, "base64").toString("utf-8");
  fileContentCache.set(cacheKey, content);
  return content;
}

/**
 * Fetch the full file tree of the repo (recursive).
 * Filters out noise (node_modules, dist, .git) and returns a compact path list.
 */
export async function getRepoTree(repo = getDefaultRepo(), ref = "main"): Promise<string[]> {
  const refData = await ghFetch<{ object: { sha: string } }>(
    `https://api.github.com/repos/${repo}/git/ref/heads/${ref}`,
  );
  const treeSha = refData.object.sha;

  const data = await ghFetch<{ tree: Array<{ path: string; type: string; size?: number }> }>(
    `https://api.github.com/repos/${repo}/git/trees/${treeSha}?recursive=1`,
  );

  const NOISE = [
    "node_modules/",
    ".git/",
    "dist/",
    ".next/",
    ".cache/",
    "coverage/",
    ".turbo/",
    ".vercel/",
    "pnpm-lock.yaml",
    "package-lock.json",
    "yarn.lock",
    "bun.lockb",
  ];

  return data.tree
    .filter((entry) => {
      if (entry.type !== "blob") return false;
      return !NOISE.some((n) => entry.path.startsWith(n) || entry.path.includes(`/${n}`));
    })
    .map((entry) => entry.path);
}

export async function searchCode(
  query: string,
  repo = getDefaultRepo(),
  fileExtensions?: string[],
  maxResults = 10,
): Promise<GithubSearchResult[]> {
  const ext = fileExtensions?.map((e) => `extension:${e.replace(".", "")}`).join(" ") ?? "";
  const q = encodeURIComponent(`${query} repo:${repo} ${ext}`.trim());

  const data = await ghFetch<{ items: unknown[] }>(
    `https://api.github.com/search/code?q=${q}&per_page=${maxResults}`,
    { headers: { Accept: "application/vnd.github.text-match+json" } },
  );

  return data.items.map((item) => {
    const i = item as { path: string; score: number; text_matches?: Array<{ fragment: string }> };
    return { filePath: i.path, snippet: i.text_matches?.[0]?.fragment ?? "", score: i.score };
  });
}

export async function readFile(
  filePath: string,
  repo = getDefaultRepo(),
  ref = "main",
): Promise<GithubFileContent> {
  const content = await fetchFileContent(filePath, repo, ref);
  return { filePath, content };
}

export async function getDiff(
  repo = getDefaultRepo(),
  pathFilter?: string,
  sinceDays = 30,
): Promise<GithubDiff> {
  const since = new Date(Date.now() - sinceDays * 86400 * 1000).toISOString();
  const pathParam = pathFilter ? `&path=${encodeURIComponent(pathFilter)}` : "";

  const commitList = await ghFetch<unknown[]>(
    `https://api.github.com/repos/${repo}/commits?since=${since}&per_page=30${pathParam}`,
  );

  // Fetch individual commits to get file details (list endpoint doesn't include files)
  const churnMap = new Map<string, number>();
  const parsed = await Promise.all(
    commitList.slice(0, 15).map(async (entry) => {
      const e = entry as { sha: string; commit: { message: string; author: { name: string } } };
      let filesChanged: string[] = [];
      try {
        const detail = await ghFetch<{ files?: Array<{ filename: string }> }>(
          `https://api.github.com/repos/${repo}/commits/${e.sha}`,
        );
        filesChanged = (detail.files ?? []).map((f) => f.filename);
        for (const f of filesChanged) churnMap.set(f, (churnMap.get(f) ?? 0) + 1);
      } catch {
        // Skip if individual commit fetch fails
      }
      return {
        sha: e.sha.slice(0, 7),
        message: e.commit.message.split("\n")[0] ?? "",
        author: e.commit.author.name,
        filesChanged,
      };
    }),
  );

  const hotspots = [...churnMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([file]) => file);

  return { commits: parsed, hotspots };
}

/**
 * Combined file analysis: dependencies + complexity in one call.
 * Uses file content cache to avoid duplicate reads.
 */
export async function analyzeFile(
  filePath: string,
  repo = getDefaultRepo(),
  ref = "main",
): Promise<FileAnalysis> {
  const content = await fetchFileContent(filePath, repo, ref);

  // Dependencies: forward imports
  const imports = extractImports(content, filePath);

  // Dependencies: reverse (who imports this file)
  const basename =
    filePath
      .replace(/\.[^.]+$/, "")
      .split("/")
      .pop() ?? "";
  let importedBy: string[] = [];
  if (basename) {
    try {
      const searchData = await ghFetch<{ items: Array<{ path: string }> }>(
        `https://api.github.com/search/code?q=${encodeURIComponent(`from "${basename}" OR from './${basename}' OR require("${basename}") repo:${repo}`)}&per_page=15`,
        { headers: { Accept: "application/vnd.github.text-match+json" } },
      );
      importedBy = searchData.items.map((i) => i.path).filter((p) => p !== filePath);
    } catch {
      // Search may fail on rate limit — degrade gracefully
    }
  }

  // Complexity
  const complexity = analyzeComplexity(filePath, content);

  return {
    dependencies: { filePath, imports, importedBy },
    complexity,
  };
}

/**
 * Get ownership map for a set of files.
 * Analyzes git commits to determine who owns what.
 */
export async function getOwnershipMap(
  paths: string[],
  repo = getDefaultRepo(),
  sinceDays = 180,
): Promise<OwnershipEntry[]> {
  const since = new Date(Date.now() - sinceDays * 86400 * 1000).toISOString();

  return Promise.all(
    paths.slice(0, 10).map(async (filePath) => {
      try {
        const commits = await ghFetch<
          Array<{
            commit: { author: { name: string; date: string } };
            author?: { login: string } | null;
          }>
        >(
          `https://api.github.com/repos/${repo}/commits?path=${encodeURIComponent(filePath)}&since=${since}&per_page=50`,
        );

        const counts = new Map<string, { commits: number; login?: string | undefined }>();
        let lastModified = "";
        for (const c of commits) {
          const name = c.commit.author.name;
          const existing = counts.get(name);
          const login = c.author?.login;
          counts.set(name, {
            commits: (existing?.commits ?? 0) + 1,
            login: existing?.login ?? login,
          });
          if (!lastModified) lastModified = c.commit.author.date;
        }

        const totalCommits = commits.length;
        const topAuthors = [...counts.entries()]
          .sort((a, b) => b[1].commits - a[1].commits)
          .slice(0, 5)
          .map(([name, data]) => ({
            name,
            login: data.login,
            commits: data.commits,
            percentage: totalCommits > 0 ? Math.round((data.commits / totalCommits) * 100) : 0,
          }));

        return { filePath, topAuthors, lastModified, totalCommits };
      } catch {
        return { filePath, topAuthors: [], lastModified: "", totalCommits: 0 };
      }
    }),
  );
}

export async function requestReviewers(
  prNumber: number,
  reviewers: string[],
  repo = getDefaultRepo(),
): Promise<void> {
  if (reviewers.length === 0) return;

  const res = await fetch(
    `https://api.github.com/repos/${repo}/pulls/${prNumber}/requested_reviewers`,
    {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ reviewers }),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    log.warn("Failed to assign reviewers", { prNumber, reviewers, status: res.status, body: text });
  }
}

export async function createPR(
  identifier: string,
  fullDocument: string,
  prDescription: string,
  adrFilename: string,
  repo = getDefaultRepo(),
): Promise<{ prUrl: string; prNumber: number; authorLogin: string }> {
  const branch = `ai-grooming/${identifier.toLowerCase()}`;

  // 1. Get main SHA
  const mainRef = await ghFetch<{ object: { sha: string } }>(
    `https://api.github.com/repos/${repo}/git/ref/heads/main`,
  );

  // 2. Create branch (idempotent — 422 = already exists)
  const branchRes = await fetch(`https://api.github.com/repos/${repo}/git/refs`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: mainRef.object.sha }),
  });
  if (!branchRes.ok && branchRes.status !== 422) {
    throw new Error(`Cannot create branch: ${branchRes.status}`);
  }

  // 3. Upsert ADR file
  let existingSha: string | undefined;
  try {
    const existing = await ghFetch<{ sha: string }>(
      `https://api.github.com/repos/${repo}/contents/${adrFilename}?ref=${branch}`,
    );
    existingSha = existing.sha;
  } catch {
    // File doesn't exist yet — will create
  }

  const putRes = await fetch(`https://api.github.com/repos/${repo}/contents/${adrFilename}`, {
    method: "PUT",
    headers: getHeaders(),
    body: JSON.stringify({
      message: `docs: AI grooming plan for ${identifier}`,
      content: Buffer.from(fullDocument).toString("base64"),
      branch,
      ...(existingSha ? { sha: existingSha } : {}),
    }),
  });
  if (!putRes.ok) {
    const text = await putRes.text();
    throw new Error(`Cannot upsert ${adrFilename}: ${putRes.status}\n${text}`);
  }

  type PRResponse = { number: number; html_url: string; user?: { login: string } | null };

  // 4. Create PR (idempotent)
  const prRes = await fetch(`https://api.github.com/repos/${repo}/pulls`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({
      title: `[AI Grooming] ${identifier}`,
      body: prDescription,
      head: branch,
      base: "main",
    }),
  });

  if (prRes.ok) {
    const pr = (await prRes.json()) as PRResponse;
    return { prUrl: pr.html_url, prNumber: pr.number, authorLogin: pr.user?.login ?? "" };
  }

  // PR already exists — find it
  const existing = await ghFetch<PRResponse[]>(
    `https://api.github.com/repos/${repo}/pulls?head=${encodeURIComponent(`${repo.split("/")[0]}:${branch}`)}&state=open`,
  );
  const pr = existing[0];
  if (!pr) throw new Error(`Cannot create or find PR for ${branch}`);
  return { prUrl: pr.html_url, prNumber: pr.number, authorLogin: pr.user?.login ?? "" };
}
