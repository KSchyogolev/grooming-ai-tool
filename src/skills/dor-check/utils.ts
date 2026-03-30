import type { LinearIssue } from "../../types";

export interface DorVerdict {
  passed: boolean;
  missing: string[];
}

function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fenced?.[1]) return fenced[1].trim();
  const braces = raw.match(/\{[\s\S]*\}/);
  if (braces) return braces[0];
  return raw.trim();
}

const PARSE_FAIL_VERDICT: DorVerdict = {
  passed: false,
  missing: ["DOR check: failed to parse LLM response — task rejected (fail-safe)"],
};

export function parseDorResult(raw: string): DorVerdict {
  try {
    const json = extractJson(raw);
    const parsed = JSON.parse(json) as DorVerdict;
    if (typeof parsed.passed !== "boolean") {
      return PARSE_FAIL_VERDICT;
    }
    return {
      passed: parsed.passed,
      missing: Array.isArray(parsed.missing) ? parsed.missing : [],
    };
  } catch {
    return PARSE_FAIL_VERDICT;
  }
}

export function buildDorComment(issue: LinearIssue, verdict: DorVerdict): string {
  const items = verdict.missing.map((m) => `- ❌ ${m}`).join("\n");

  const lines = [
    `## DOR Check — ${issue.identifier}   [AI-DOR-CHECK]`,
    "",
    "**Task description is not detailed enough for automated grooming.**",
    "",
    "### What failed",
    "",
    items,
    "",
    "### Good description template",
    "",
    "```",
    "## Problem",
    "[What is broken / missing and WHY it matters]",
    "",
    "## Expected Behavior",
    "[Happy path + key edge cases]",
    "",
    "## Acceptance Criteria",
    "- [ ] [Specific testable condition 1]",
    "- [ ] [Specific testable condition 2]",
    "",
    "```",
    "",
    "---",
    "*After updating the description, the task will be re-checked automatically.*",
  ];

  return lines.join("\n");
}
