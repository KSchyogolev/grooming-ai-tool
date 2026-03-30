import type { GatheredContext } from "../types";

/**
 * Builds a structured block with code analysis data (deps, ownership, complexity)
 * specifically for the ADR prompt so the LLM can reference it in Code Analysis Summary.
 */
export function buildCodeAnalysisContext(context: GatheredContext): string {
  const { dependencies, ownership, complexity } = context.codeAnalysis;
  const sections: string[] = [];

  if (dependencies.length > 0) {
    const lines = dependencies.map((d) => {
      const imports = d.imports.length > 0 ? d.imports.join(", ") : "none";
      const importedBy = d.importedBy.length > 0 ? d.importedBy.join(", ") : "none";
      return `  - ${d.filePath}: imports [${imports}], imported by [${importedBy}]`;
    });
    sections.push(`MODULE DEPENDENCIES (blast radius):\n${lines.join("\n")}`);
  }

  if (ownership.length > 0) {
    const lines = ownership.map((o) => {
      const authors = o.topAuthors
        .slice(0, 3)
        .map((a) => `${a.name} (${a.percentage}%, ${a.commits} commits)`)
        .join(", ");
      return `  - ${o.filePath}: ${authors || "unknown"} — ${o.totalCommits} total commits`;
    });
    sections.push(`CODE OWNERSHIP:\n${lines.join("\n")}`);
  }

  if (complexity.length > 0) {
    const lines = complexity.map((c) => {
      const longFns =
        c.longFunctions.length > 0 ? `, long functions: ${c.longFunctions.join(", ")}` : "";
      return `  - ${c.filePath}: ${c.complexity} complexity, ${c.lines} lines, ${c.functions} functions, max indent ${c.maxIndentDepth}${longFns}`;
    });
    sections.push(`COMPLEXITY ANALYSIS:\n${lines.join("\n")}`);
  }

  if (sections.length === 0) {
    return "CODE ANALYSIS DATA: No analysis data collected. The Code Analysis Summary in your output should note this as [NEEDS INVESTIGATION].";
  }

  return `CODE ANALYSIS DATA (use this to inform your architecture plan — reference findings in Context and Decision sections):\n\n${sections.join("\n\n")}`;
}

export function buildContextString(context: GatheredContext): string {
  const parts: string[] = [];

  for (const f of context.relevantFiles) {
    parts.push(`[SOURCE: ${f.filePath}]\n${f.content.slice(0, 1500)}`);
  }

  const readPaths = new Set(context.relevantFiles.map((f) => f.filePath));
  const uniqueResults = context.searchResults.filter((r) => !readPaths.has(r.filePath));
  if (uniqueResults.length > 0) {
    const snippets = uniqueResults
      .slice(0, 10)
      .map((r) => `  ${r.filePath}: ${r.snippet.slice(0, 200)}`)
      .join("\n");
    parts.push(`[SEARCH RESULTS — additional matches]\n${snippets}`);
  }

  if (context.docs.length > 0) {
    const docSnippets = context.docs
      .slice(0, 5)
      .map((d) => `  ${d.filePath}: ${d.snippet.slice(0, 300)}`)
      .join("\n");
    parts.push(`[DOCS]\n${docSnippets}`);
  }

  if (context.diff.hotspots.length > 0) {
    parts.push(`High-churn files (30d): ${context.diff.hotspots.join(", ")}`);
  }

  const { dependencies, ownership, complexity } = context.codeAnalysis;
  if (dependencies.length > 0) {
    const depLines = dependencies.map((d) => {
      const imports = d.imports.length > 0 ? `imports: ${d.imports.join(", ")}` : "no imports";
      const importedBy =
        d.importedBy.length > 0 ? `imported by: ${d.importedBy.join(", ")}` : "no dependents";
      return `  ${d.filePath}: ${imports} | ${importedBy}`;
    });
    parts.push(`[MODULE DEPENDENCIES — blast radius]\n${depLines.join("\n")}`);
  }

  if (ownership.length > 0) {
    const ownerLines = ownership.map((o) => {
      const authors = o.topAuthors
        .slice(0, 3)
        .map((a) => `${a.name} (${a.percentage}%)`)
        .join(", ");
      return `  ${o.filePath}: ${authors || "unknown"} (${o.totalCommits} commits)`;
    });
    parts.push(`[CODE OWNERSHIP — reviewers/experts]\n${ownerLines.join("\n")}`);
  }

  if (complexity.length > 0) {
    const complexLines = complexity.map(
      (c) =>
        `  ${c.filePath}: ${c.complexity} complexity, ${c.lines} lines, ${c.functions} functions, max indent ${c.maxIndentDepth}${c.longFunctions.length > 0 ? `, long: ${c.longFunctions.join(", ")}` : ""}`,
    );
    parts.push(`[COMPLEXITY ANALYSIS]\n${complexLines.join("\n")}`);
  }

  return parts.join("\n\n---\n\n");
}
