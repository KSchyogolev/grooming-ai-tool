export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description: string;
  stateName: string;
  labels: string[];
  parentIdentifier?: string | undefined;
  assignee?: string | undefined;
  priority: number;
  url: string;
}

export interface GithubSearchResult {
  filePath: string;
  snippet: string;
  score: number;
}

export interface GithubFileContent {
  filePath: string;
  content: string;
}

export interface GithubDiff {
  commits: Array<{
    sha: string;
    message: string;
    author: string;
    filesChanged: string[];
  }>;
  hotspots: string[];
}

/** Import dependency for a single file */
export interface ModuleDependency {
  filePath: string;
  imports: string[];
  importedBy: string[];
}

/** Code ownership entry — who owns what */
export interface OwnershipEntry {
  filePath: string;
  topAuthors: Array<{
    name: string;
    login?: string | undefined;
    commits: number;
    percentage: number;
  }>;
  lastModified: string;
  totalCommits: number;
}

/** Complexity metrics for a file */
export interface ComplexityReport {
  filePath: string;
  lines: number;
  functions: number;
  maxIndentDepth: number;
  longFunctions: string[];
  complexity: "low" | "medium" | "high";
}

/** Combined result from analyzeFile: deps + complexity in one call */
export interface FileAnalysis {
  dependencies: ModuleDependency;
  complexity: ComplexityReport;
}

/** Aggregated code analysis results */
export interface CodeAnalysis {
  dependencies: ModuleDependency[];
  ownership: OwnershipEntry[];
  complexity: ComplexityReport[];
}

export interface GatheredContext {
  issue: LinearIssue;
  relevantFiles: GithubFileContent[];
  searchResults: GithubSearchResult[];
  docs: GithubSearchResult[];
  diff: GithubDiff;
  codeAnalysis: CodeAnalysis;
}

export interface GroomingPlan {
  linearComment: string;
  prDescription: string;
  fullDocument: string;
  adrFilename: string;
  /** GitHub logins of suggested reviewers (top contributors) */
  suggestedReviewers: string[];
}

// --- Webhook payloads ---

export interface LinearWebhookPayload {
  type: string;
  action: string;
  updatedFrom?: { stateId?: string; [key: string]: unknown };
  data: {
    id: string;
    identifier: string;
    title: string;
    description?: string | undefined;
    state?: { id: string; name: string } | undefined;
    labels?: Array<{ name: string }> | undefined;
    parent?: { identifier: string } | undefined;
    assignee?: { name: string } | undefined;
    priority: number;
    url: string;
    // Comment-specific fields
    body?: string | undefined;
    issueId?: string | undefined;
    parentId?: string | undefined;
    issue?: { id: string; identifier: string } | undefined;
    // Reaction-specific fields
    emoji?: string | undefined;
    comment?: { id: string; body?: string; issueId?: string } | undefined;
  };
}

/** Trigger type determines how processIssue behaves */
export type GroomingTrigger = "state_change" | "dor_recheck";

export interface GithubPRWebhookPayload {
  action: string;
  pull_request: {
    merged: boolean;
    title: string;
    number: number;
    html_url: string;
    labels: Array<{ name: string }>;
    head: { ref: string };
  };
}
