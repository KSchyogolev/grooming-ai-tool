import type { EpicSize, RunStats, SubTask } from "../skills/types";

export function buildLinearComment(
  decomposition: SubTask[],
  epicSize: EpicSize,
  estimateHours: number,
  questions: string[],
  adrFilename: string,
  issueIdentifier: string,
  issueUrl: string,
  stats?: RunStats,
): string {
  const table = decomposition
    .map((t, i) => {
      const hours = t.estimateHours ? `${t.estimateHours}h` : "—";
      return `| ${i + 1} | ${t.title} | \`${t.size}\` | ${hours} | ${t.dependsOn.join(", ") || "—"} |`;
    })
    .join("\n");

  const questionsSection =
    questions.length > 0
      ? questions.map((q) => `- [ ] ${q}`).join("\n")
      : `> No blocking questions. See \`[NEEDS INVESTIGATION]\` markers in \`${adrFilename}\` if any.`;

  const sizeLabel = epicSize === "XXL" ? "XXL — consider splitting the epic" : epicSize;

  return `## AI Grooming Draft — [${issueIdentifier}](${issueUrl})   [AI-GROOMING]

> **Complexity:** ${sizeLabel} · **Estimate:** ~${estimateHours}h · AI-generated — review before grooming meeting.

### Subtasks

| # | Task | Size | Estimate | Deps |
|---|------|------|----------|------|
${table}

**Total:** ~${sizeLabel} (~${estimateHours}h)

### Open Questions

${questionsSection}

---
*Full details: \`${adrFilename}\`*${stats ? `\n> Tokens: ${stats.usage.totalTokens} · Cost: ~$${stats.usage.estimatedCostUsd.toFixed(2)} · Time: ${Math.round(stats.durationMs / 1000)}s` : ""}`;
}
