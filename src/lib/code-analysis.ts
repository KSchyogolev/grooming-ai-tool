import type { ComplexityReport } from "../types";

const IMPORT_PATTERN =
  /(?:from\s+["']([^"']+)["']|import\(["']([^"']+)["']\)|require\(["']([^"']+)["']\)|export\s+(?:\*|\{[^}]*\})\s+from\s+["']([^"']+)["'])/g;

/** Extract import paths from TypeScript/JavaScript source */
export function extractImports(content: string, contextPath: string): string[] {
  const dir = contextPath.split("/").slice(0, -1).join("/");
  const seen = new Set<string>();

  for (const match of content.matchAll(IMPORT_PATTERN)) {
    const imp = match[1] ?? match[2] ?? match[3] ?? match[4];
    if (imp) seen.add(resolveImportPath(imp, dir));
  }

  return [...seen];
}

function resolveImportPath(imp: string, dir: string): string {
  if (!imp.startsWith(".")) return imp;
  const parts = dir.split("/").filter(Boolean);
  for (const segment of imp.split("/")) {
    if (segment === "..") parts.pop();
    else if (segment !== ".") parts.push(segment);
  }
  return parts.join("/").replace(/\.(js|ts|tsx|jsx)$/, "");
}

/** Heuristic-based complexity analysis from source text */
export function analyzeComplexity(filePath: string, content: string): ComplexityReport {
  const lines = content.split("\n");
  const lineCount = lines.length;

  const functionPattern =
    /^[\s]*(export\s+)?(async\s+)?function\s+(\w+)|(\w+)\s*[=(]\s*(async\s+)?\(/;
  const classMethodPattern = /^\s+(async\s+)?(\w+)\s*\([^)]*\)\s*[:{]/;

  let functions = 0;
  let maxIndentDepth = 0;
  const longFunctions: string[] = [];

  let currentFnName: string | null = null;
  let currentFnStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const trimmed = line.trimStart();

    const indent = line.length - trimmed.length;
    const indentDepth = Math.floor(indent / 2);
    if (trimmed.length > 0 && indentDepth > maxIndentDepth) {
      maxIndentDepth = indentDepth;
    }

    const fnMatch = trimmed.match(functionPattern) ?? trimmed.match(classMethodPattern);
    if (fnMatch && !trimmed.startsWith("//") && !trimmed.startsWith("*")) {
      if (currentFnName && i - currentFnStart > 50) {
        longFunctions.push(`${currentFnName} (${i - currentFnStart} lines)`);
      }
      currentFnName = fnMatch[3] ?? fnMatch[4] ?? fnMatch[2] ?? "anonymous";
      currentFnStart = i;
      functions++;
    }
  }

  if (currentFnName && lines.length - currentFnStart > 50) {
    longFunctions.push(`${currentFnName} (${lines.length - currentFnStart} lines)`);
  }

  let complexity: ComplexityReport["complexity"] = "low";
  if (lineCount > 500 || maxIndentDepth > 8 || longFunctions.length > 2) {
    complexity = "high";
  } else if (lineCount > 200 || maxIndentDepth > 5 || longFunctions.length > 0) {
    complexity = "medium";
  }

  return { filePath, lines: lineCount, functions, maxIndentDepth, longFunctions, complexity };
}
