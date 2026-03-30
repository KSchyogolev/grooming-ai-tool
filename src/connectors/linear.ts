import { LinearClient } from "@linear/sdk";
import type { LinearIssue } from "../types";

export interface LinearConnectorConfig {
  apiKey: string;
  teamKey: string;
  groomingState: string;
}

let _linearConfig: LinearConnectorConfig | null = null;
let _client: LinearClient | null = null;

export function initLinear(config: LinearConnectorConfig): void {
  _linearConfig = config;
  _client = new LinearClient({ apiKey: config.apiKey });
}

function getLinearConfig(): LinearConnectorConfig {
  if (!_linearConfig) throw new Error("Linear connector not initialized — call initLinear() first");
  return _linearConfig;
}

function client(): LinearClient {
  if (!_client) throw new Error("Linear connector not initialized — call initLinear() first");
  return _client;
}

export async function getIssuesReadyForGrooming(): Promise<LinearIssue[]> {
  const cfg = getLinearConfig();
  const teamId = cfg.teamKey;
  const stateName = cfg.groomingState;
  const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();

  const issues = await client().issues({
    filter: {
      team: { key: { eq: teamId } },
      state: { name: { eq: stateName } },
      updatedAt: { gte: since },
    },
    first: 20,
    includeArchived: false,
  });

  return Promise.all(issues.nodes.map(resolveIssue));
}

/** Fetch by human-readable identifier like "ENG-123" */
export async function getIssueByIdentifier(identifier: string): Promise<LinearIssue> {
  const [teamKey, numberStr] = identifier.split("-");
  if (!teamKey || !numberStr) throw new Error(`Invalid identifier format: ${identifier}`);
  const results = await client().issues({
    filter: { number: { eq: Number(numberStr) }, team: { key: { eq: teamKey } } },
    first: 1,
  });
  const issue = results.nodes[0];
  if (!issue) throw new Error(`Issue not found: ${identifier}`);
  return resolveIssue(issue);
}

/** Fetch issue by Linear UUID */
export async function getIssueById(issueId: string): Promise<LinearIssue> {
  const issue = await client().issue(issueId);
  return resolveIssue(issue);
}

export type DorCheckStatus = "none" | "pending" | "interacted";

export interface IssueMarkers {
  hasGrooming: boolean;
  dorStatus: DorCheckStatus;
}

/**
 * Single-pass comment check: grooming marker + DOR status + user interaction.
 * Replaces separate hasGroomingComment + upsertDorComment lookups.
 */
export async function getIssueMarkers(issueId: string): Promise<IssueMarkers> {
  const issue = await client().issue(issueId);
  const comments = await issue.comments({ first: 50 });

  const hasGrooming = comments.nodes.some((c) => c.body?.includes("[AI-GROOMING]"));

  const dorComment = comments.nodes
    .filter((c) => c.body?.includes("[AI-DOR-CHECK]"))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  if (!dorComment) {
    return { hasGrooming, dorStatus: "none" };
  }

  const hasInteraction = await checkCommentInteraction(dorComment.id);
  return { hasGrooming, dorStatus: hasInteraction ? "interacted" : "pending" };
}

async function linearGraphQL<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      Authorization: getLinearConfig().apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  return res.json() as Promise<T>;
}

async function checkCommentInteraction(commentId: string): Promise<boolean> {
  const body = await linearGraphQL<{
    data?: { comment?: { children?: { nodes?: unknown[] }; reactions?: unknown[] } };
  }>("query ($id: String!) { comment(id: $id) { children { nodes { id } } reactions { id } } }", {
    id: commentId,
  });
  const comment = body.data?.comment;
  if (!comment) return false;
  return (comment.children?.nodes?.length ?? 0) > 0 || (comment.reactions?.length ?? 0) > 0;
}

export async function postComment(issueId: string, markdown: string): Promise<string> {
  const result = await client().createComment({ issueId, body: markdown });
  const comment = await result.comment;
  if (!comment) throw new Error(`Failed to post comment to ${issueId}`);
  return comment.id;
}

/** Update issue workflow state by state name */
export async function updateIssueState(issueId: string, stateName: string): Promise<void> {
  const issue = await client().issue(issueId);
  const team = await issue.team;
  if (!team) throw new Error(`No team found for issue ${issueId}`);

  const states = await team.states();
  const targetState = states.nodes.find((s) => s.name === stateName);
  if (!targetState) throw new Error(`State "${stateName}" not found for team ${team.key}`);

  await client().updateIssue(issueId, { stateId: targetState.id });
}

/** Check if a comment belongs to an issue with a pending DOR check */
export async function getIssueIdForComment(commentId: string): Promise<string | null> {
  const body = await linearGraphQL<{
    data?: { comment?: { issue?: { id: string } } };
  }>("query ($id: String!) { comment(id: $id) { issue { id } } }", { id: commentId });
  return body.data?.comment?.issue?.id ?? null;
}

async function resolveIssue(
  issue: Awaited<ReturnType<LinearClient["issue"]>>,
): Promise<LinearIssue> {
  const [state, labels, parent, assignee] = await Promise.all([
    issue.state,
    issue.labels(),
    issue.parent,
    issue.assignee,
  ]);

  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description ?? "",
    stateName: state?.name ?? "",
    labels: labels.nodes.map((l) => l.name),
    parentIdentifier: parent?.identifier,
    assignee: assignee?.name,
    priority: issue.priority,
    url: issue.url,
  };
}
