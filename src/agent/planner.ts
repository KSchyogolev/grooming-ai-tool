import type Anthropic from "@anthropic-ai/sdk";
import { buildCodeAnalysisContext, buildContextString } from "../lib/context-formatter";
import { buildLinearComment } from "../lib/linear-comment";
import { call, callWithThinking } from "../lib/llm";
import type { UsageTracker } from "../lib/usage-tracker";
import * as log from "../logger";
import { ADR_SYSTEM_PROMPT, buildAdrMetadata } from "../skills/adr-writer";
import { buildPrDescription, getReviewerLogins } from "../skills/pr-description";
import {
  DECOMPOSITION_SYSTEM_PROMPT,
  parseDecomposition,
  rollupSize,
} from "../skills/task-decomposition";
import type { EpicSize, SkillContext, SubTaskSize, TaskComplexity } from "../skills/types";
import type { GatheredContext, GroomingPlan } from "../types";
import { STEP_CONFIG } from "./config";

function deriveTaskComplexity(epicSize: EpicSize): TaskComplexity {
  if (epicSize === "S") return "S";
  if (epicSize === "M") return "M";
  if (epicSize === "L") return "L";
  return "XL";
}

const SIZE_TO_HOURS: Record<SubTaskSize, number> = { XS: 1, S: 3, M: 6, L: 12, XL: 20 };

function sumEstimateHours(subtasks: { estimateHours?: number; size: SubTaskSize }[]): number {
  return subtasks.reduce((sum, t) => sum + (t.estimateHours ?? SIZE_TO_HOURS[t.size]), 0);
}

export async function runPlanner(
  client: Anthropic,
  context: GatheredContext,
  tracker?: UsageTracker,
  startTimeMs = Date.now(),
): Promise<GroomingPlan> {
  const id = context.issue.identifier;
  const contextStr = buildContextString(context);

  const decompositionRaw = await log.timed(
    () =>
      call(client, {
        model: STEP_CONFIG.decomposition.model,
        maxTokens: STEP_CONFIG.decomposition.maxTokens,
        system: DECOMPOSITION_SYSTEM_PROMPT,
        prompt: `Issue: ${id} — ${context.issue.title}\n\nDescription:\n${context.issue.description}\n\nCodebase context:\n${contextStr}\n\nOutput JSON only.`,
        tracker,
      }),
    "Decomposition done",
    { issueId: id, step: "planner:decomposition" },
  );
  const { subtasks: decomposition, questions } = parseDecomposition(decompositionRaw);
  const epicSize = rollupSize(decomposition);
  const taskComplexity = deriveTaskComplexity(epicSize);
  const estimateHours = sumEstimateHours(decomposition);

  log.info("Subtasks parsed", {
    issueId: id,
    step: "planner:decomposition",
    count: decomposition.length,
    epicSize,
    taskComplexity,
    estimateHours,
    questions: questions.length,
  });

  const codeAnalysisBlock = buildCodeAnalysisContext(context);
  const analyzedFiles = context.relevantFiles.map((f) => f.filePath);

  const adrRaw = await log.timed(
    () =>
      callWithThinking(client, {
        system: ADR_SYSTEM_PROMPT,
        prompt: `TASK_COMPLEXITY: ${taskComplexity}\n\nIssue: ${id} — ${context.issue.title}\n\nDescription:\n${context.issue.description}\n\nCodebase context:\n${contextStr}\n\n${codeAnalysisBlock}\n\nSubtasks:\n${decomposition.map((t, i) => `${i + 1}. ${t.title} (${t.size}, ~${t.estimateHours ?? "?"}h)`).join("\n")}\n\nGenerate the architecture plan. Markdown only. Reference specific files and code analysis findings using (see: file:line) citations.`,
        tracker,
      }),
    "ADR generated",
    { issueId: id, step: "planner:adr", taskComplexity },
  );
  const adrMarkdown = adrRaw.trim();

  const { filename: adrFilename, heading: adrHeading } = buildAdrMetadata(
    context.issue.identifier,
    context.issue.title,
  );

  const skillCtx: SkillContext = {
    issueIdentifier: context.issue.identifier,
    issueTitle: context.issue.title,
    issueDescription: context.issue.description,
    issueUrl: context.issue.url,
    relevantFiles: context.relevantFiles.map((f) => ({
      filePath: f.filePath,
      snippet: f.content.slice(0, 200),
    })),
    hotspots: context.diff.hotspots,
    recentCommits: context.diff.commits.slice(0, 5),
    architecturePlan: adrMarkdown,
    decomposition,
    codeAnalysis: context.codeAnalysis,
    questions,
    taskComplexity,
    analyzedFiles,
    estimateHours,
    stats: tracker
      ? { usage: tracker.summarize(), durationMs: Date.now() - startTimeMs }
      : undefined,
  };

  return {
    linearComment: buildLinearComment(
      decomposition,
      epicSize,
      estimateHours,
      questions,
      adrFilename,
      context.issue.identifier,
      context.issue.url,
      tracker ? { usage: tracker.summarize(), durationMs: Date.now() - startTimeMs } : undefined,
    ),
    prDescription: buildPrDescription(skillCtx),
    fullDocument: `${adrHeading}\n\n---\n\n${adrMarkdown}`,
    adrFilename,
    suggestedReviewers: getReviewerLogins(skillCtx),
  };
}
