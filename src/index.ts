import Anthropic from "@anthropic-ai/sdk";
import { checkDor } from "./agent/dor-gate";
import { runOrchestrator } from "./agent/orchestrator";
import { runPlanner } from "./agent/planner";
import { runWriter } from "./agent/writer";
import { loadConfig, validateConnectivity } from "./config";
import type { Config } from "./config";
import { clearFileCache } from "./connectors/github";
import {
  getIssueMarkers,
  getIssuesReadyForGrooming,
  postComment,
  updateIssueState,
} from "./connectors/linear";
import { UsageTracker } from "./lib/usage-tracker";
import * as log from "./logger";
import type { GroomingTrigger, LinearIssue } from "./types";

export async function processIssue(
  client: Anthropic,
  issue: LinearIssue,
  config: Config,
  trigger: GroomingTrigger = "state_change",
): Promise<void> {
  clearFileCache();
  const id = issue.identifier;
  const startTime = Date.now();
  const tracker = new UsageTracker();
  const isRecheck = trigger === "dor_recheck";
  log.info("Starting issue", { issueId: id, step: "start", trigger });

  const { hasGrooming, dorStatus } = await getIssueMarkers(issue.id);

  if (hasGrooming && !isRecheck) {
    log.info("Already processed — skipping", { issueId: id, step: "idempotency" });
    return;
  }

  if (dorStatus === "pending") {
    log.info("DOR failed, no user response — skipping", {
      issueId: id,
      step: "dor-gate",
    });
    return;
  }

  if (isRecheck && dorStatus !== "interacted") {
    log.info("DOR recheck but no interaction — skipping", {
      issueId: id,
      step: "dor-gate",
      dorStatus,
    });
    return;
  }

  const dor = await log.timed(() => checkDor(client, issue, tracker), "DOR checked", {
    issueId: id,
    step: "dor-gate",
    recheck: isRecheck,
  });

  if (!dor.passed) {
    if (!config.dryRun) {
      await postComment(issue.id, dor.comment);
    } else {
      console.log("\n--- DOR FAILED ---");
      console.log(dor.comment);
    }
    log.info("DOR failed — feedback posted", {
      issueId: id,
      step: "dor-gate",
    });
    return;
  }

  log.info("DOR passed", { issueId: id, step: "dor-gate" });

  const context = await log.timed(
    () => runOrchestrator(client, issue, tracker),
    "Context gathered",
    {
      issueId: id,
      step: "orchestrator",
    },
  );

  const plan = await log.timed(
    () => runPlanner(client, context, tracker, startTime),
    "Plan generated",
    { issueId: id, step: "planner" },
  );

  if (config.dryRun) {
    log.info("Dry run — skipping publish", { issueId: id, step: "dry-run" });
    console.log("\n--- LINEAR COMMENT ---");
    console.log(plan.linearComment);
    console.log("\n--- PR DESCRIPTION ---");
    console.log(plan.prDescription);
    console.log("\n--- ADR ---");
    console.log(plan.fullDocument);
    return;
  }

  const result = await log.timed(() => runWriter(issue, plan), "Published", {
    issueId: id,
    step: "writer",
  });

  const prLinkComment = `> **PR:** [#${result.prNumber}](${result.prUrl})`;
  await postComment(issue.id, prLinkComment);

  await updateIssueState(issue.id, config.linearNeedReviewState);
  log.info("Done — moved to review", {
    issueId: id,
    step: "complete",
    prUrl: result.prUrl,
    newState: config.linearNeedReviewState,
  });
}

async function main(): Promise<void> {
  const config = loadConfig();

  if (!config.dryRun) {
    await validateConnectivity(config);
  }

  const client = new Anthropic({ apiKey: config.anthropicApiKey });
  const issues = await getIssuesReadyForGrooming();

  log.info("Batch run started", {
    step: "main",
    issuesFound: issues.length,
  });

  for (const issue of issues) {
    try {
      await processIssue(client, issue, config);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error("Issue processing failed", { issueId: issue.identifier, error: msg });
    }
  }

  log.info("Batch run complete", {
    step: "main",
    processed: issues.length,
    total: issues.length,
  });
}

const isDirectRun = typeof Bun !== "undefined" && Bun.main === __filename;
if (isDirectRun) {
  main().catch((err) => {
    log.error("Fatal error", { error: String(err) });
    process.exit(1);
  });
}
