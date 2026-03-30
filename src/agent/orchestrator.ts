import type Anthropic from "@anthropic-ai/sdk";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import {
  analyzeFile,
  getDefaultRepo,
  getDiff,
  getOwnershipMap,
  getRepoTree,
  readFile,
  searchCode,
} from "../connectors/github";
import { withRetry } from "../lib/anthropic-retry";
import type { UsageTracker } from "../lib/usage-tracker";
import * as log from "../logger";
import type {
  FileAnalysis,
  GatheredContext,
  GithubDiff,
  GithubFileContent,
  GithubSearchResult,
  LinearIssue,
  OwnershipEntry,
} from "../types";
import { MAX_ORCHESTRATOR_ITERATIONS, STEP_CONFIG } from "./config";
import { TOOLS } from "./tools";

type ToolResult = { name: string; data: unknown };

function validateToolInput(name: string, input: Record<string, unknown>): void {
  switch (name) {
    case "github_search_code":
      if (typeof input.query !== "string" || input.query.length === 0) {
        throw new Error("github_search_code: query must be a non-empty string");
      }
      break;
    case "github_read_file":
    case "github_analyze_file":
      if (typeof input.file_path !== "string" || input.file_path.length === 0) {
        throw new Error(`${name}: file_path must be a non-empty string`);
      }
      break;
    case "github_ownership_map":
      if (!Array.isArray(input.paths) || input.paths.length === 0) {
        throw new Error("github_ownership_map: paths must be a non-empty array");
      }
      break;
  }
}

async function executeTool(
  name: string,
  input: Record<string, unknown>,
  repo: string,
): Promise<ToolResult> {
  validateToolInput(name, input);

  switch (name) {
    case "github_search_code": {
      const query = String(input.query);
      const exts = Array.isArray(input.file_extensions)
        ? input.file_extensions.map(String)
        : undefined;
      const max = typeof input.max_results === "number" ? input.max_results : undefined;
      const data = await searchCode(query, repo, exts, max);
      return { name, data };
    }
    case "github_read_file": {
      const data = await readFile(
        String(input.file_path),
        repo,
        input.ref ? String(input.ref) : undefined,
      );
      return { name, data };
    }
    case "github_get_diff": {
      const data = await getDiff(
        repo,
        input.path_filter ? String(input.path_filter) : undefined,
        typeof input.since_days === "number" ? input.since_days : undefined,
      );
      return { name, data };
    }
    case "github_analyze_file": {
      const data = await analyzeFile(String(input.file_path), repo);
      return { name, data };
    }
    case "github_ownership_map": {
      const paths = (input.paths as unknown[]).map(String);
      const data = await getOwnershipMap(
        paths,
        repo,
        typeof input.since_days === "number" ? input.since_days : undefined,
      );
      return { name, data };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

const MAX_TREE_CHARS = 30_000;
const MAX_TOOL_RESULT_CHARS = 12_000;

function buildSystemPrompt(repoTree: string): string {
  const truncatedTree =
    repoTree.length > MAX_TREE_CHARS
      ? `${repoTree.slice(0, MAX_TREE_CHARS)}\n\n... (${repoTree.split("\n").length} files total, truncated for context limit. Use github_search_code to find files not shown here.)`
      : repoTree;

  return `You are gathering codebase context for a grooming agent. Your output feeds into an architecture decision record and task decomposition. Quality depends DIRECTLY on the context you collect.

  You already have the full repository file tree below. Use it to pick the right files — do NOT guess paths.

  ## MANDATORY steps — complete ALL, call multiple tools per message when possible:

  1. **Read files** — pick 3-5 most relevant files from the tree based on the issue. Read them with github_read_file. ALWAYS read at least 2 source code files (not just configs).
  2. **Get diff/hotspots** — one github_get_diff call with path_filter scoped to the task's area (e.g. "apps/web/src" not the whole repo).
  3. **Analyze files (CRITICAL)** — call github_analyze_file on 2-3 key source files you read. This provides imports/importedBy and complexity. WITHOUT this, Code Analysis will be empty.
  4. **Get ownership** — one github_ownership_map call with the file paths you analyzed.

  ## RULES
  - You ALREADY have the file tree. Use it to pick files — no guessing.
  - Steps 3 and 4 are NOT optional. You MUST call github_analyze_file and github_ownership_map before stopping.
  - Call multiple tools in a single message to save iterations (e.g. read 3 files at once, or analyze + ownership together).
  - Use github_search_code only if you need to find specific string patterns in code. It is NOT needed for discovering files — you have the tree.
  - Stop when all 4 steps are done.

## REPOSITORY FILE TREE
${truncatedTree}`;
}

export async function runOrchestrator(
  client: Anthropic,
  issue: LinearIssue,
  tracker?: UsageTracker,
): Promise<GatheredContext> {
  const collected: GatheredContext = {
    issue,
    relevantFiles: [],
    searchResults: [],
    docs: [],
    diff: { commits: [], hotspots: [] },
    codeAnalysis: { dependencies: [], ownership: [], complexity: [] },
  };

  const repo = getDefaultRepo();
  const tree = await log.timed(() => getRepoTree(repo), "Repo tree fetched", {
    issueId: issue.identifier,
    step: "orchestrator:tree",
  });
  const repoTree = tree.join("\n");

  log.info("Repo tree size", {
    issueId: issue.identifier,
    step: "orchestrator",
    fileCount: tree.length,
    chars: repoTree.length,
  });

  const systemPrompt = buildSystemPrompt(repoTree);

  const messages: MessageParam[] = [
    {
      role: "user",
      content: `Linear issue: ${issue.identifier}
Title: ${issue.title}
Description:
${issue.description}

Repository: ${repo}

Start gathering context. You have the file tree in the system prompt — use it to pick files.`,
    },
  ];

  const toolCounts: Record<string, number> = {};

  for (let i = 0; i < MAX_ORCHESTRATOR_ITERATIONS; i++) {
    log.info("Orchestrator iteration", {
      issueId: issue.identifier,
      step: "orchestrator",
      iteration: i,
    });

    const response = await withRetry(
      () =>
        client.messages.create({
          model: STEP_CONFIG.orchestrator.model,
          max_tokens: STEP_CONFIG.orchestrator.maxTokens,
          system: systemPrompt,
          tools: TOOLS,
          messages,
        }),
      `orchestrator:${issue.identifier}:iter${i}`,
    );
    tracker?.record(STEP_CONFIG.orchestrator.model, {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    });

    const textBlocks = response.content.filter((b) => b.type === "text");
    if (textBlocks.length > 0) {
      const reasoning = (textBlocks[0] as Anthropic.TextBlock).text;
      log.info("LLM reasoning", {
        issueId: issue.identifier,
        step: "orchestrator",
        iteration: i,
        text: reasoning.slice(0, 300),
      });
    }

    messages.push({ role: "assistant", content: response.content });
    if (response.stop_reason === "end_turn") break;

    if (response.stop_reason === "tool_use") {
      const toolBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );

      const results = await Promise.all(
        toolBlocks.map(async (block) => {
          const input = block.input as Record<string, unknown>;
          toolCounts[block.name] = (toolCounts[block.name] ?? 0) + 1;

          log.info("Tool call", {
            issueId: issue.identifier,
            step: "orchestrator",
            tool: block.name,
            input: JSON.stringify(input).slice(0, 200),
          });

          let content: string;
          try {
            const toolResult = await executeTool(block.name, input, repo);
            collectResult(collected, toolResult);
            const serialized = JSON.stringify(toolResult.data);
            content =
              serialized.length > MAX_TOOL_RESULT_CHARS
                ? `${serialized.slice(0, MAX_TOOL_RESULT_CHARS)}\n... truncated ...`
                : serialized;

            const resultData = toolResult.data;
            const isEmpty = Array.isArray(resultData) && resultData.length === 0;
            log.info("Tool call succeeded", {
              issueId: issue.identifier,
              step: "orchestrator",
              tool: block.name,
              resultSize: isEmpty ? 0 : Array.isArray(resultData) ? resultData.length : 1,
            });
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            content = JSON.stringify({ error: errorMsg });
            log.warn("Tool call failed (graceful)", {
              issueId: issue.identifier,
              step: "orchestrator",
              tool: block.name,
              error: errorMsg,
            });
          }
          return { type: "tool_result" as const, tool_use_id: block.id, content };
        }),
      );
      messages.push({ role: "user", content: results });
    }
  }

  log.info("Context collected", {
    issueId: issue.identifier,
    step: "orchestrator",
    files: collected.relevantFiles.length,
    searchResults: collected.searchResults.length,
    docs: collected.docs.length,
    hotspots: collected.diff.hotspots.length,
    deps: collected.codeAnalysis.dependencies.length,
    ownership: collected.codeAnalysis.ownership.length,
    complexity: collected.codeAnalysis.complexity.length,
    toolCounts,
  });

  return collected;
}

function collectResult(ctx: GatheredContext, result: ToolResult): void {
  switch (result.name) {
    case "github_search_code": {
      const items = result.data as GithubSearchResult[];
      // Separate docs (.md) from code results, deduplicate both
      const existingSearch = new Set(ctx.searchResults.map((r) => r.filePath));
      const existingDocs = new Set(ctx.docs.map((d) => d.filePath));
      for (const item of items) {
        if (item.filePath.endsWith(".md")) {
          if (!existingDocs.has(item.filePath)) ctx.docs.push(item);
        } else {
          if (!existingSearch.has(item.filePath)) ctx.searchResults.push(item);
        }
      }
      break;
    }
    case "github_read_file": {
      const file = result.data as GithubFileContent;
      if (!ctx.relevantFiles.some((f) => f.filePath === file.filePath)) {
        ctx.relevantFiles.push(file);
      }
      break;
    }
    case "github_get_diff":
      ctx.diff = result.data as GithubDiff;
      break;
    case "github_analyze_file": {
      const analysis = result.data as FileAnalysis;
      ctx.codeAnalysis.dependencies.push(analysis.dependencies);
      ctx.codeAnalysis.complexity.push(analysis.complexity);
      break;
    }
    case "github_ownership_map":
      ctx.codeAnalysis.ownership.push(...(result.data as OwnershipEntry[]));
      break;
  }
}
