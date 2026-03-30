import { createPR, requestReviewers } from "../connectors/github";
import { postComment } from "../connectors/linear";
import type { GroomingPlan, LinearIssue } from "../types";

export interface WriterResult {
  commentId: string;
  prUrl: string;
  prNumber: number;
}

export async function runWriter(issue: LinearIssue, plan: GroomingPlan): Promise<WriterResult> {
  const [commentId, { prUrl, prNumber, authorLogin }] = await Promise.all([
    postComment(issue.id, plan.linearComment),
    createPR(issue.identifier, plan.fullDocument, plan.prDescription, plan.adrFilename),
  ]);

  const reviewers = plan.suggestedReviewers.filter(
    (login) => login.toLowerCase() !== authorLogin.toLowerCase(),
  );
  if (reviewers.length > 0) {
    await requestReviewers(prNumber, reviewers);
  }

  return { commentId, prUrl, prNumber };
}
