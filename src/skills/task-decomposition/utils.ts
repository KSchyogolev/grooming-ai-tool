import * as log from "../../logger";
import type { SubTask } from "../types";

export interface DecompositionResult {
  subtasks: SubTask[];
  questions: string[];
}

export function parseDecomposition(raw: string): DecompositionResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const objMatch = raw.match(/\{[\s\S]+\}/);
    const arrMatch = raw.match(/\[[\s\S]+\]/);
    const candidate = objMatch?.[0] ?? arrMatch?.[0];
    if (candidate) {
      try {
        parsed = JSON.parse(candidate);
      } catch {
        parsed = JSON.parse(repairTruncatedJson(candidate));
      }
    } else {
      throw new Error(`Decomposition not JSON: ${raw.slice(0, 300)}`);
    }
  }

  if (Array.isArray(parsed)) {
    return { subtasks: parsed.map(validateSubTask), questions: [] };
  }

  const obj = parsed as Record<string, unknown>;
  const subtasksArr = obj.subtasks;
  if (!Array.isArray(subtasksArr)) throw new Error("Decomposition: missing subtasks array");

  const questions = Array.isArray(obj.questions)
    ? (obj.questions as unknown[]).filter((q): q is string => typeof q === "string")
    : [];

  return { subtasks: subtasksArr.map(validateSubTask), questions };
}

function validateSubTask(raw: unknown): SubTask {
  const t = raw as Record<string, unknown>;
  if (!t.title || typeof t.title !== "string") {
    throw new Error(`SubTask missing title: ${JSON.stringify(raw)}`);
  }
  const userStory = (t.userStory as string) ?? "";
  if (!userStory.toLowerCase().startsWith("as a")) {
    log.warn("SubTask userStory doesn't follow 'As a...' format", { title: t.title as string });
  }
  const validSizes = ["XS", "S", "M", "L", "XL"] as const;
  const size = t.size as string;
  if (!validSizes.includes(size as (typeof validSizes)[number])) {
    throw new Error(`Invalid size "${size}" for "${t.title}"`);
  }
  const base: SubTask = {
    title: t.title as string,
    userStory,
    acceptanceCriteria: (t.acceptanceCriteria as string[]) ?? [],
    technicalDetails: (t.technicalDetails as string) ?? "",
    size: size as SubTask["size"],
    dependsOn: (t.dependsOn as string[]) ?? [],
  };
  if (typeof t.estimateHours === "number" && t.estimateHours > 0) {
    base.estimateHours = t.estimateHours;
  }
  return base;
}

/**
 * Attempt to fix truncated JSON by stripping the last incomplete element
 * and closing any open brackets/braces.
 */
function repairTruncatedJson(raw: string): string {
  let text = raw.trim();

  // Drop a trailing comma or incomplete trailing value after the last complete element
  const lastComplete = Math.max(text.lastIndexOf("},"), text.lastIndexOf("}]"));
  if (lastComplete !== -1) {
    text = text.slice(0, lastComplete + 1); // keep up to the closing `}`
  }

  // Close any unmatched brackets/braces
  const opens: string[] = [];
  let inString = false;
  let escape = false;
  for (const ch of text) {
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{" || ch === "[") opens.push(ch);
    if (ch === "}" || ch === "]") opens.pop();
  }

  for (let i = opens.length - 1; i >= 0; i--) {
    text += opens[i] === "{" ? "}" : "]";
  }

  log.warn("Repaired truncated JSON", { addedClosing: opens.length });
  return text;
}

export function rollupSize(subtasks: SubTask[]): string {
  const pts: Record<SubTask["size"], number> = { XS: 1, S: 2, M: 4, L: 8, XL: 16 };
  const total = subtasks.reduce((sum, t) => sum + pts[t.size], 0);
  if (total <= 3) return "S";
  if (total <= 6) return "M";
  if (total <= 12) return "L";
  if (total <= 24) return "XL";
  return "XXL — consider splitting the epic";
}
