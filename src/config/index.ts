export interface Config {
  linearApiKey: string;
  linearTeamId: string;
  linearGroomingState: string;
  linearNeedReviewState: string;
  linearReadyForDevState: string;
  linearWebhookSecret?: string | undefined;
  githubToken: string;
  githubRepo: string;
  githubWebhookSecret?: string | undefined;
  anthropicApiKey: string;
  dryRun: boolean;
}

export function loadConfig(): Config {
  const required: Record<string, string | undefined> = {
    LINEAR_API_KEY: process.env.LINEAR_API_KEY,
    LINEAR_TEAM_KEY: process.env.LINEAR_TEAM_KEY,
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    GITHUB_REPO: process.env.GITHUB_REPO,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  };

  const missing = Object.entries(required)
    .filter(([, v]) => !v)
    .map(([k]) => k);

  if (missing.length > 0) {
    throw new Error(`Missing env vars: ${missing.join(", ")}`);
  }

  return {
    linearApiKey: required.LINEAR_API_KEY as string,
    linearTeamId: required.LINEAR_TEAM_KEY as string,
    linearGroomingState: process.env.LINEAR_GROOMING_STATE ?? "Ready for Grooming",
    linearNeedReviewState: process.env.LINEAR_NEED_REVIEW_STATE ?? "Need Grooming Review",
    linearReadyForDevState: process.env.LINEAR_READY_FOR_DEV_STATE ?? "Ready for Dev",
    githubToken: required.GITHUB_TOKEN as string,
    githubRepo: required.GITHUB_REPO as string,
    githubWebhookSecret: process.env.GITHUB_WEBHOOK_SECRET,
    anthropicApiKey: required.ANTHROPIC_API_KEY as string,
    dryRun: process.env.DRY_RUN === "true",
    linearWebhookSecret: process.env.LINEAR_WEBHOOK_SECRET,
  };
}

/** Quick connectivity check — fail fast before processing */
export async function validateConnectivity(config: Config): Promise<void> {
  const ghRes = await fetch(`https://api.github.com/repos/${config.githubRepo}`, {
    headers: {
      Authorization: `Bearer ${config.githubToken}`,
      Accept: "application/vnd.github+json",
    },
  });
  if (!ghRes.ok) {
    throw new Error(
      `GitHub repo "${config.githubRepo}" not accessible (${ghRes.status}). Check GITHUB_TOKEN and GITHUB_REPO.`,
    );
  }

  const linearRes = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      Authorization: config.linearApiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: "{ viewer { id } }" }),
  });
  if (!linearRes.ok) {
    throw new Error(`Linear API not accessible (${linearRes.status}). Check LINEAR_API_KEY.`);
  }
}
