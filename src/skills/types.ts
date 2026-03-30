import type { UsageSummary } from "../lib/usage-tracker";
import type { CodeAnalysis } from "../types";

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
  size: "XS" | "S" | "M" | "L" | "XL";
  dependsOn: string[];
  estimateHours?: number;
}
