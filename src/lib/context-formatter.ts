import type { ComplexityReport, GatheredContext, ModuleDependency, OwnershipEntry } from "../types";

interface FormatStyle {
  depLine: (d: ModuleDependency) => string;
  ownerLine: (o: OwnershipEntry) => string;
  complexityLine: (c: ComplexityReport) => string;
}

const adrStyle: FormatStyle = {
  depLine: (d) => {
    const imports = d.imports.length > 0 ? d.imports.join(", ") : "none";
    const importedBy = d.importedBy.length > 0 ? d.importedBy.join(", ") : "none";
    return `  - ${d.filePath}: imports [${imports}], imported by [${importedBy}]`;
  },
  ownerLine: (o) => {
    const authors = o.topAuthors
      .slice(0, 3)
      .map((a) => `${a.name} (${a.percentage}%, ${a.commits} commits)`)
      .join(", ");
    return `  - ${o.filePath}: ${authors || "unknown"} — ${o.totalCommits} total commits`;
  },
  complexityLine: (c) => {
    const longFns =
      c.longFunctions.length > 0 ? `, long functions: ${c.longFunctions.join(", ")}` : "";
    return `  - ${c.filePath}: ${c.complexity} complexity, ${c.lines} lines, ${c.functions} functions, max indent ${c.maxIndentDepth}${longFns}`;
  },
};

const contextStyle: FormatStyle = {
  depLine: (d) => {
    const imports = d.imports.length > 0 ? `imports: ${d.imports.join(", ")}` : "no imports";
    const importedBy =
      d.importedBy.length > 0 ? `imported by: ${d.importedBy.join(", ")}` : "no dependents";
    return `  ${d.filePath}: ${imports} | ${importedBy}`;
  },
  ownerLine: (o) => {
    const authors = o.topAuthors
      .slice(0, 3)
      .map((a) => `${a.name} (${a.percentage}%)`)
      .join(", ");
    return `  ${o.filePath}: ${authors || "unknown"} (${o.totalCommits} commits)`;
  },
  complexityLine: (c) => {
    const longFns = c.longFunctions.length > 0 ? `, long: ${c.longFunctions.join(", ")}` : "";
    return `  ${c.filePath}: ${c.complexity} complexity, ${c.lines} lines, ${c.functions} functions, max indent ${c.maxIndentDepth}${longFns}`;
  },
};

function formatCodeAnalysisSections(
  codeAnalysis: GatheredContext["codeAnalysis"],
  style: FormatStyle,
  headers: { deps: string; ownership: string; complexity: string },
): string[] {
  const { dependencies, ownership, complexity } = codeAnalysis;
  const sections: string[] = [];

  if (dependencies.length > 0) {
    sections.push(`${headers.deps}\n${dependencies.map(style.depLine).join("\n")}`);
  }
  if (ownership.length > 0) {
    sections.push(`${headers.ownership}\n${ownership.map(style.ownerLine).join("\n")}`);
  }
  if (complexity.length > 0) {
    sections.push(`${headers.complexity}\n${complexity.map(style.complexityLine).join("\n")}`);
  }

  return sections;
}

/**
 * Builds a structured block with code analysis data (deps, ownership, complexity)
 * specifically for the ADR prompt so the LLM can reference it in Code Analysis Summary.
 */
export function buildCodeAnalysisContext(context: GatheredContext): string {
  const sections = formatCodeAnalysisSections(context.codeAnalysis, adrStyle, {
    deps: "MODULE DEPENDENCIES (blast radius):",
    ownership: "CODE OWNERSHIP:",
    complexity: "COMPLEXITY ANALYSIS:",
  });

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

  const analysisSections = formatCodeAnalysisSections(context.codeAnalysis, contextStyle, {
    deps: "[MODULE DEPENDENCIES — blast radius]",
    ownership: "[CODE OWNERSHIP — reviewers/experts]",
    complexity: "[COMPLEXITY ANALYSIS]",
  });
  parts.push(...analysisSections);

  return parts.join("\n\n---\n\n");
}
