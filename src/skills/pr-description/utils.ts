import type { SkillContext } from "../types";

/**
 * Extract reviewer GitHub logins from ownership data, ranked by commit count.
 * Returns up to `limit` logins (only those with a known GitHub login).
 */
export function getReviewerLogins(ctx: SkillContext, limit = 3): string[] {
  const { ownership } = ctx.codeAnalysis;
  if (ownership.length === 0) return [];

  const reviewers = new Map<string, { commits: number; login?: string | undefined }>();
  for (const o of ownership) {
    for (const a of o.topAuthors) {
      const existing = reviewers.get(a.name);
      reviewers.set(a.name, {
        commits: (existing?.commits ?? 0) + a.commits,
        login: existing?.login ?? a.login,
      });
    }
  }

  return [...reviewers.entries()]
    .sort((a, b) => b[1].commits - a[1].commits)
    .filter(([, data]) => data.login)
    .slice(0, limit)
    .map(([, data]) => data.login as string);
}
