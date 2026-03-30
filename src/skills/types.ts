import type { UsageSummary } from "../lib/usage-tracker";
import type { CodeAnalysis } from "../types";

export const SUBTASK_SIZES = ["XS", "S", "M", "L", "XL"] as const;
export type SubTaskSize = (typeof SUBTASK_SIZES)[number];

export const EPIC_SIZES = ["S", "M", "L", "XL", "XXL"] as const;
export type EpicSize = (typeof EPIC_SIZES)[number];

export type TaskComplexity = "S" | "M" | "L" | "XL";

export interface RunStats {
  usage: UsageSummary;
  durationMs: number;
}

export interface SkillContext {
  issueIdentifier: string;
  issueTitle: string;
  issueDescription: string;
  issueUrl: string;
  relevantFiles: Array<{ filePath: string; snippet: string }>;
  hotspots: string[];
  recentCommits: Array<{ sha: string; message: string; author: string }>;
  architecturePlan: string;
  decomposition: SubTask[];
  codeAnalysis: CodeAnalysis;
  questions: string[];
  taskComplexity: TaskComplexity;
  analyzedFiles: string[];
  estimateHours: number;
  stats?: RunStats | undefined;
}

export interface SubTask {
  title: string;
  userStory: string;
  acceptanceCriteria: string[];
  technicalDetails: string;
  size: SubTaskSize;
  dependsOn: string[];
  estimateHours?: number;
}
