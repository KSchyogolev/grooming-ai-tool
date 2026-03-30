import crypto from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { loadConfig } from "./config";
import {
  getIssueById,
  getIssueByIdentifier,
  getIssueMarkers,
  updateIssueState,
} from "./connectors/linear";
import { initConnectors, processIssue } from "./index";
import * as log from "./logger";
import type { GithubPRWebhookPayload, LinearIssue, LinearWebhookPayload } from "./types";

/** Verify Linear webhook signature (HMAC SHA256) */
export function verifyLinearSignature(body: string, signature: string, secret: string): boolean {
  if (!secret) return false;
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(body);
  const expected = hmac.digest("hex");
  if (signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(
    new Uint8Array(Buffer.from(signature)),
    new Uint8Array(Buffer.from(expected)),
  );
}

/** Verify GitHub webhook signature (HMAC SHA256) */
export function verifyGithubSignature(body: string, signature: string, secret: string): boolean {
  if (!secret) return false;
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(body);
  const expected = `sha256=${hmac.digest("hex")}`;
  if (signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(
    new Uint8Array(Buffer.from(signature)),
    new Uint8Array(Buffer.from(expected)),
  );
}

function isValidLinearPayload(payload: unknown): payload is LinearWebhookPayload {
  if (!payload || typeof payload !== "object") return false;
  const p = payload as Record<string, unknown>;
  return typeof p.type === "string" && typeof p.action === "string" && p.data != null;
}

/** Convert webhook payload to LinearIssue */
function toLinearIssue(data: LinearWebhookPayload["data"]): LinearIssue {
  return {
    id: data.id,
    identifier: data.identifier,
    title: data.title,
    description: data.description ?? "",
    stateName: data.state?.name ?? "",
    labels: data.labels?.map((l) => l.name) ?? [],
    parentIdentifier: data.parent?.identifier,
    assignee: data.assignee?.name,
    priority: data.priority,
    url: data.url,
  };
}

export interface WebhookResult {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Handle Linear webhook — dispatches based on event type:
 * 1. Issue state → "Ready for Grooming" → start grooming
 * 2. Comment on issue with pending DOR → recheck DOR
 * 3. Reaction on DOR comment → recheck DOR
 */
export async function handleLinearWebhook(
  rawBody: string,
  signature: string | null,
): Promise<WebhookResult> {
  const config = loadConfig();
  initConnectors(config);

  if (config.linearWebhookSecret) {
    if (!signature || !verifyLinearSignature(rawBody, signature, config.linearWebhookSecret)) {
      log.warn("Webhook signature invalid", { step: "webhook" });
      return { status: 401, body: { error: "Invalid signature" } };
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { error: "Invalid JSON" } };
  }

  if (!isValidLinearPayload(parsed)) {
    return { status: 400, body: { error: "Invalid payload structure" } };
  }

  const payload = parsed;
  const { type, action } = payload;
  log.info("Webhook received", { step: "webhook", type, action });

  // --- Trigger 1: Issue moved to "Ready for Grooming" ---
  if (type === "Issue" && action === "update" && payload.updatedFrom?.stateId) {
    const newState = payload.data.state?.name;
    if (newState !== config.linearGroomingState) {
      return { status: 200, body: { ok: true, action: "ignored", reason: "wrong state" } };
    }

    const issue = toLinearIssue(payload.data);
    log.info("Grooming triggered by state change", { issueId: issue.identifier, step: "webhook" });

    try {
      const client = new Anthropic({ apiKey: config.anthropicApiKey });
      await processIssue(client, issue, config, "state_change");
      return {
        status: 200,
        body: { ok: true, issueId: issue.identifier, trigger: "state_change" },
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      log.error("Grooming failed", { issueId: issue.identifier, error: errorMsg });
      return { status: 500, body: { error: "Processing failed", issueId: issue.identifier } };
    }
  }

  // --- Trigger 2: Comment created → possible DOR recheck ---
  if (type === "Comment" && action === "create") {
    const commentBody = payload.data.body ?? "";
    if (commentBody.includes("[AI-DOR-CHECK]") || commentBody.includes("[AI-GROOMING]")) {
      return { status: 200, body: { ok: true, action: "ignored", reason: "bot comment" } };
    }

    const issueId = payload.data.issueId ?? payload.data.issue?.id;
    if (!issueId) {
      return { status: 200, body: { ok: true, action: "ignored", reason: "no issueId" } };
    }

    return handleDorRecheck(issueId, "comment", config);
  }

  // --- Trigger 3: Reaction on comment → possible DOR recheck ---
  if (type === "Reaction" && action === "create") {
    const commentData = payload.data.comment;
    const issueId = commentData?.issueId;
    if (!issueId) {
      return {
        status: 200,
        body: { ok: true, action: "ignored", reason: "no issueId on reaction" },
      };
    }

    const commentBody = commentData?.body ?? "";
    if (!commentBody.includes("[AI-DOR-CHECK]")) {
      return {
        status: 200,
        body: { ok: true, action: "ignored", reason: "reaction not on DOR comment" },
      };
    }

    return handleDorRecheck(issueId, "reaction", config);
  }

  return { status: 200, body: { ok: true, action: "ignored" } };
}

/** Recheck DOR when user interacted with a DOR comment */
async function handleDorRecheck(
  issueId: string,
  source: "comment" | "reaction",
  config: ReturnType<typeof loadConfig>,
): Promise<WebhookResult> {
  const { dorStatus } = await getIssueMarkers(issueId);
  if (dorStatus !== "interacted") {
    return { status: 200, body: { ok: true, action: "ignored", reason: "no interacted DOR" } };
  }

  const issue = await getIssueById(issueId);

  if (issue.stateName !== config.linearGroomingState) {
    return {
      status: 200,
      body: { ok: true, action: "ignored", reason: "issue not in grooming state" },
    };
  }

  log.info("DOR recheck triggered", { issueId: issue.identifier, step: "webhook", source });

  try {
    const client = new Anthropic({ apiKey: config.anthropicApiKey });
    await processIssue(client, issue, config, "dor_recheck");
    return { status: 200, body: { ok: true, issueId: issue.identifier, trigger: "dor_recheck" } };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.error("DOR recheck failed", { issueId: issue.identifier, error: errorMsg });
    return { status: 500, body: { error: "Processing failed", issueId: issue.identifier } };
  }
}

/**
 * Handle GitHub webhook — PR merged with [AI Grooming] tag.
 * Moves the associated Linear issue to "Ready for Dev".
 */
export async function handleGithubWebhook(
  rawBody: string,
  signature: string | null,
): Promise<WebhookResult> {
  const config = loadConfig();
  initConnectors(config);

  if (config.githubWebhookSecret) {
    if (!signature || !verifyGithubSignature(rawBody, signature, config.githubWebhookSecret)) {
      log.warn("GitHub webhook signature invalid", { step: "webhook-github" });
      return { status: 401, body: { error: "Invalid signature" } };
    }
  }

  let payload: GithubPRWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as GithubPRWebhookPayload;
  } catch {
    return { status: 400, body: { error: "Invalid JSON" } };
  }

  if (payload.action !== "closed" || !payload.pull_request?.merged) {
    return { status: 200, body: { ok: true, action: "ignored", reason: "not a merge" } };
  }

  const prTitle = payload.pull_request.title;
  const match = prTitle.match(/\[AI Grooming\]\s+(\w+-\d+)/);
  if (!match?.[1]) {
    return { status: 200, body: { ok: true, action: "ignored", reason: "no [AI Grooming] tag" } };
  }

  const identifier = match[1];
  log.info("PR merged — moving to Ready for Dev", {
    step: "webhook-github",
    identifier,
    prNumber: payload.pull_request.number,
  });

  try {
    const issue = await getIssueByIdentifier(identifier);
    await updateIssueState(issue.id, config.linearReadyForDevState);
    log.info("Issue moved to Ready for Dev", {
      step: "webhook-github",
      issueId: issue.identifier,
      newState: config.linearReadyForDevState,
    });
    return {
      status: 200,
      body: { ok: true, issueId: identifier, newState: config.linearReadyForDevState },
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.error("Failed to move issue", { identifier, error: errorMsg });
    return { status: 500, body: { error: "Failed to update issue", identifier } };
  }
}
