import type { Tool } from "@anthropic-ai/sdk/resources/messages";

export const TOOLS: Tool[] = [
  {
    name: "github_search_code",
    description:
      'Search code in GitHub. Use specific technical terms from the issue. Set file_extensions to [".md"] to search docs.',
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string" },
        file_extensions: {
          type: "array",
          items: { type: "string" },
          description: 'File extensions to filter (e.g. [".ts"], [".md"] for docs)',
        },
        max_results: { type: "number", default: 10 },
      },
      required: ["query"],
    },
  },
  {
    name: "github_read_file",
    description: "Read full content of a specific file found via search.",
    input_schema: {
      type: "object" as const,
      properties: {
        file_path: { type: "string" },
        ref: { type: "string", default: "main" },
      },
      required: ["file_path"],
    },
  },
  {
    name: "github_get_diff",
    description: "Get recent commits and high-churn hotspot files",
    input_schema: {
      type: "object" as const,
      properties: {
        path_filter: { type: "string" },
        since_days: { type: "number", default: 30 },
      },
    },
  },
  {
    name: "github_analyze_file",
    description:
      "Analyze a file: import dependencies (blast radius — what it imports + who imports it) AND complexity (lines, functions, nesting, long functions). Use after reading a key file.",
    input_schema: {
      type: "object" as const,
      properties: {
        file_path: {
          type: "string",
          description: "Path to the file to analyze (e.g. src/api/router.ts)",
        },
      },
      required: ["file_path"],
    },
  },
  {
    name: "github_ownership_map",
    description:
      "Get code ownership for files: top contributors with commit counts and percentages. Use to identify reviewers and domain experts.",
    input_schema: {
      type: "object" as const,
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
          description: "File paths to analyze (max 10)",
        },
        since_days: { type: "number", default: 180 },
      },
      required: ["paths"],
    },
  },
];
