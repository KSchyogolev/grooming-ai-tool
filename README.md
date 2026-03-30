# AI Grooming Agent

An autonomous multi-agent system that takes Linear issues in "Ready for Grooming" status, gathers context from GitHub (code + docs), generates task decomposition and an architectural decision record (ADR), then publishes results back to Linear and GitHub as a PR.

## How It Works

```
Linear Issue              GitHub Repository              Linear + GitHub
(Ready for Grooming)      (code, docs, history)          (comment + PR)
       │                         │                             ▲
       ▼                         ▼                             │
┌─────────────┐  ┌───────────────────────┐  ┌──────────┐  ┌────────┐
│  DOR Gate   │─▶│     Orchestrator      │─▶│ Planner  │─▶│ Writer │
│  (Haiku)    │  │  (Sonnet tool-use)    │  │(Haiku +  │  │(publish│
│             │  │                       │  │  Opus)   │  │results)│
└─────────────┘  └───────────────────────┘  └──────────┘  └────────┘
 Validates        Agentic context           Decomposition   Comment
 issue quality    gathering loop            + ADR            + PR + state
```

The pipeline has five stages:

1. **DOR Gate** — validates the issue description against Definition of Ready criteria. Rejects poorly described issues with actionable feedback.
2. **Orchestrator** — Claude Sonnet autonomously searches code, reads files, analyzes dependencies, and gathers context through a tool-use loop (up to 12 iterations).
3. **Planner** — generates task decomposition (Haiku) and an architectural decision record (Opus with extended thinking).
4. **Writer** — publishes a structured comment to Linear and creates a PR with the ADR document in GitHub.
5. **State transition** — posts a PR link comment to the issue and moves it to "Need Grooming Review" status in Linear.

## Agent Architecture

### Roles

| Role | Module | Model | Responsibility |
|------|--------|-------|----------------|
| **Gate Keeper** | `dor-gate.ts` | Claude Haiku | Validate issue quality before processing |
| **Retriever** | `orchestrator.ts` | Claude Sonnet | Gather relevant context via tool-use |
| **Planner** | `planner.ts` | Haiku + Opus | Generate decomposition and ADR |
| **Writer** | `writer.ts` | — (pure functions + API) | Publish results to Linear and GitHub |

### Tool Layer

The orchestrator has access to 5 GitHub tools:

| Tool | Purpose |
|------|---------|
| `github_search_code` | Search code and docs in the repository |
| `github_read_file` | Read file contents (with per-run caching) |
| `github_get_diff` | Recent commits and hotspot files by churn |
| `github_analyze_file` | Module dependencies + complexity in one call |
| `github_ownership_map` | File ownership by git commit history |

### Connectors

| Connector | Read | Write |
|-----------|------|-------|
| **Linear** | Issues by status/id/identifier, issue markers, interaction checks | Comments, state transitions |
| **GitHub** | Code search, file read, diffs, analysis, ownership, repo tree | Branches, files (upsert), PRs, reviewer assignment |

## Model Selection

| Step | Model | Why |
|------|-------|-----|
| DOR Gate | Claude Haiku (temp=0) | Structured validation, deterministic output, cheap |
| Context Gathering | Claude Sonnet | Best quality/speed balance for multi-step tool-use |
| Task Decomposition | Claude Haiku | Structured JSON, clear template, no deep reasoning needed |
| ADR Generation | Claude Opus + extended thinking | Architectural trade-offs require deep reasoning |
| Assembly | No LLM | Pure functions, deterministic, zero cost |

### Cost per Issue

| Step | Estimated Cost |
|------|---------------|
| DOR Gate | ~$0.001 |
| Orchestrator | ~$0.12 |
| Decomposition | ~$0.002 |
| ADR | ~$0.36 |
| **Total** | **~$0.48** |

### Latency per Issue

| Step | Time |
|------|------|
| Orchestrator | 15–30s |
| Decomposition | 2–3s |
| ADR | 5–10s |
| Writer | 3–5s |
| **Total** | **30–50s** |

## Output Artifacts

### Linear Comment
- Subtask table with sizes, descriptions, and acceptance criteria
- Epic size rollup and hour estimate
- Open questions and `[NEEDS INVESTIGATION]` markers
- Link to the ADR pull request

### GitHub Pull Request
- ADR document in Michael Nygard format (Context → Decision → Consequences)
- PR description with:
  - Blast radius table (imports / imported-by / risk level)
  - Code ownership table (top contributors with percentages)
  - Complexity analysis (lines, functions, indent depth)
  - Suggested reviewers based on ownership data
  - Review checklist

## Setup

### Prerequisites

- [Bun](https://bun.sh/) runtime
- Linear API key with read/write access to issues and comments
- GitHub token with repo access (code, branches, PRs)
- Anthropic API key

### Installation

```bash
bun install
```

### Configuration

Copy the example environment file and fill in your values:

```bash
cp .env.example .env
```

| Variable | Required | Description |
|----------|----------|-------------|
| `LINEAR_API_KEY` | Yes | Linear API key |
| `LINEAR_TEAM_KEY` | Yes | Linear team key (e.g., `ENG`) |
| `LINEAR_GROOMING_STATE` | No | Source state name (default: `Ready for Grooming`) |
| `LINEAR_NEED_REVIEW_STATE` | No | State to move issue after grooming (default: `Need Grooming Review`) |
| `LINEAR_READY_FOR_DEV_STATE` | No | State to move issue after ADR PR merge (default: `Ready for Dev`) |
| `LINEAR_WEBHOOK_SECRET` | No | HMAC secret for Linear webhook signature verification |
| `GITHUB_TOKEN` | Yes | GitHub personal access token |
| `GITHUB_REPO` | Yes | Repository in `owner/repo` format |
| `GITHUB_WEBHOOK_SECRET` | No | HMAC secret for GitHub webhook signature verification |
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key |
| `DRY_RUN` | No | Skip publishing, print results to console (default: `false`) |

## Running

### CLI / Cron (batch mode)

```bash
bun run start
```

Fetches all issues in the target status from Linear and processes them sequentially.

### Dry Run

```bash
DRY_RUN=true bun run start
```

Runs the full pipeline but prints results to console instead of publishing.

### Webhooks (event-driven)

The project deploys to [Vercel](https://vercel.com) as serverless functions via the `api/` directory. Two webhook endpoints are available:

**`POST /api/webhook/linear`** — handles three Linear event types:

1. **Issue state change** → issue moved to "Ready for Grooming" → runs the full grooming pipeline
2. **Comment created** → user replied to a DOR feedback comment → triggers DOR re-check
3. **Reaction on comment** → user reacted to a DOR comment → triggers DOR re-check

**`POST /api/webhook/github`** — handles GitHub PR events:

1. **PR merged** with `[AI Grooming]` tag in the title → moves the associated Linear issue to "Ready for Dev"

Both endpoints verify HMAC SHA-256 signatures when the corresponding secret is configured.

## Idempotency

Every stage is designed to be safely re-runnable:

| Mechanism | How |
|-----------|-----|
| **Comment dedup** | `[AI-GROOMING]` / `[AI-DOR-CHECK]` markers checked before publishing |
| **DOR re-check** | Tracks interaction status (`none` → `pending` → `interacted`) to avoid spamming |
| **Branch creation** | HTTP 422 (already exists) is handled gracefully |
| **File upsert** | Uses SHA to update existing files |
| **PR creation** | Returns existing open PR if branch already has one |
| **File cache** | Cleared at the start of each `processIssue` run |

## Hallucination Control

1. **Grounded in tool results** — all code claims come from actual GitHub API responses
2. **Citation requirement** — ADR prompt enforces `(see: file:line)` or `[NEEDS INVESTIGATION]`
3. **Human review** — output is a PR (reviewable, editable) + Linear comment with TODO/questions
4. **No fabricated data** — PR tables (ownership, complexity, blast radius) use real analysis data

## Code Analysis Features

### Module Dependencies
- Parses ES imports, dynamic imports, and `require()` via regex
- Resolves relative paths to full file paths
- Finds reverse dependencies through GitHub Code Search
- Zero external dependencies (no AST parser needed)

### Complexity Analysis
- Lines, function count, max indent depth, long functions (>50 lines)
- Classifies files as `low` / `medium` / `high` complexity
- Pure function, language-agnostic heuristics

### Team Ownership
- Git commit history over 180 days per file
- Top 5 contributors with commit percentages
- Feeds into suggested reviewer selection

### Graceful Degradation
All analysis tools degrade gracefully — API errors result in empty data sections rather than pipeline failures.

## Rate Limit Handling

All external API calls are wrapped with retry logic:

| API | Retry Strategy | Delays |
|-----|---------------|--------|
| **GitHub REST** | 3 retries on 429 / 5xx | 1s → 2s → 4s |
| **Anthropic Claude** | 4 retries on 429 (rate\_limit) | 15s → 30s → 45s → 60s |
| **Anthropic Claude** | 4 retries on 5xx (server error) | 2s → 5s → 10s → 20s |

Anthropic retry also respects the `retry-after` header when present.

## Project Structure

```
grooming-tool/
├── src/
│   ├── index.ts                 # Entry point (CLI / cron), processIssue logic
│   ├── webhook.ts               # Webhook handlers (Linear + GitHub)
│   ├── logger.ts                # Structured JSON logging with timing
│   ├── agent/
│   │   ├── config.ts            # Model IDs and step configuration
│   │   ├── dor-gate.ts          # Definition of Ready validation
│   │   ├── orchestrator.ts      # Agentic context gathering loop
│   │   ├── planner.ts           # Decomposition + ADR generation
│   │   ├── tools.ts             # Tool definitions (Anthropic SDK format)
│   │   └── writer.ts            # Publish to Linear + GitHub
│   ├── config/
│   │   └── index.ts             # Environment config loading + validation
│   ├── connectors/
│   │   ├── github.ts            # GitHub REST API wrapper (retry, caching)
│   │   └── linear.ts            # Linear SDK + GraphQL wrapper
│   ├── lib/
│   │   ├── anthropic-retry.ts   # Retry wrapper for Anthropic 429 / 5xx errors
│   │   ├── code-analysis.ts     # Import extraction + complexity heuristics
│   │   ├── context-formatter.ts # Context string builders for LLM prompts
│   │   ├── linear-comment.ts    # Linear comment markdown builder
│   │   ├── llm.ts               # Anthropic SDK call wrappers
│   │   └── usage-tracker.ts     # Token usage and cost tracking
│   ├── skills/
│   │   ├── types.ts             # Shared interfaces (SubTask, SkillContext, etc.)
│   │   ├── adr-writer/          # ADR prompt + metadata builder
│   │   ├── dor-check/           # DOR prompt + result parser + comment builder
│   │   ├── pr-description/      # PR body builder + reviewer extraction
│   │   └── task-decomposition/  # Decomposition prompt + parser + rollup
│   └── types/
│       └── index.ts             # Shared data types
├── api/
│   └── webhook/
│       ├── linear.ts            # Vercel serverless — Linear webhook endpoint
│       └── github.ts            # Vercel serverless — GitHub PR merge endpoint
├── tests/
│   ├── anthropic-retry.test.ts
│   ├── code-analysis.test.ts
│   ├── config.test.ts
│   ├── context-formatter.test.ts
│   ├── linear-comment.test.ts
│   ├── llm.test.ts
│   ├── logger.test.ts
│   ├── orchestrator.test.ts
│   ├── pipeline.test.ts
│   ├── skills.test.ts
│   └── webhook.test.ts
├── package.json
├── tsconfig.json
├── biome.json
├── vercel.json                  # Serverless function config (max duration)
└── .env.example
```

## Testing

```bash
bun test
```

Tests cover:
- **Pipeline integration** — full planner flow with mocked issue/context
- **Orchestrator** — tool dispatch and context collection
- **Webhook** — Linear and GitHub webhook handlers, signature verification
- **Skills** — decomposition parsing, size rollup, PR description building, ADR metadata
- **Config** — environment loading with isolated `process.env`
- **Logger** — structured output format and timing
- **Code analysis** — complexity classification on various file structures
- **LLM wrappers** — call and callWithThinking behavior
- **Context formatter** — context string assembly
- **Linear comment** — markdown comment generation
- **Anthropic retry** — rate limit (429) and server error (5xx) retry with backoff, `retry-after` header support

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | [Bun](https://bun.sh/) |
| Language | TypeScript (strict mode) |
| LLM | [Anthropic Claude](https://docs.anthropic.com/) (Haiku / Sonnet / Opus) |
| Task Tracker | [Linear](https://linear.app/) |
| Code Host | [GitHub](https://github.com/) REST API |
| Deployment | [Vercel](https://vercel.com) (serverless functions) |
| Linter | [Biome](https://biomejs.dev/) |
