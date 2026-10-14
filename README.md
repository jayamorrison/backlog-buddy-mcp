# Backlog Buddy MCP

An [MCP](https://modelcontextprotocol.io) server that gives AI assistants a product owner's checklist for user stories.

The assistant does the writing. Backlog Buddy checks the drafts against **INVEST** and acceptance-criteria rules, suggests how to **split** stories that are too big, and **exports** the finished backlog to Markdown, CSV or Jira's CSV importer.

## Why

AI assistants write plausible-looking user stories quickly, but they routinely:

- skip the "so that" (the value),
- write acceptance criteria that only cover the happy path,
- use untestable words like *fast*, *intuitive* or *seamless*,
- bundle two or three stories into one.

Backlog Buddy turns those habits into specific, fixable findings, so the assistant can revise its own work before you ever see it.

## What it provides

| Type | Name | What it does |
|---|---|---|
| Tool | `validate_story` | Scores one story 0–100 against INVEST, with a verdict (ready / needs-work / not-ready) and suggested fixes |
| Tool | `validate_backlog` | Checks a set of stories, totals the points and flags likely duplicates |
| Tool | `suggest_splits` | Recommends splitting patterns (workflow steps, CRUD, business rules, data variations, interfaces, happy path first, defer performance, user roles, spikes) |
| Tool | `export_backlog` | Outputs `markdown`, `csv`, or `jira-csv` |
| Prompt | `feature_to_stories` | Guided flow: feature brief → drafted stories → checked → revised → export |
| Resource | `backlogbuddy://guides/invest` | One-page guide to INVEST, Given/When/Then and splitting |

### Example check

Input:

> As a user, I want to search and export transactions quickly
> Acceptance criteria: *Search should be fast and intuitive*

Backlog Buddy reports, among other things:

- no "so that" clause, so the value is implied rather than stated
- "user" is a generic persona
- the goal contains "and", which often means two stories
- "quickly", "fast" and "intuitive" can't be tested
- the acceptance criterion isn't in Given / When / Then form

## Setup

Requires [Node.js](https://nodejs.org) 20 or later.

```bash
npm install
npm run build
npm test        # unit tests for the checking, splitting and export logic
npm run e2e     # starts the server and exercises every tool over MCP
```

### Use it in Claude Desktop

Add this to `claude_desktop_config.json` (Settings → Developer → Edit Config), using the full path to `dist/server.js` on your machine, then restart Claude Desktop:

```json
{
  "mcpServers": {
    "backlog-buddy": {
      "command": "node",
      "args": ["C:\\path\\to\\backlog-buddy-mcp\\dist\\server.js"]
    }
  }
}
```

Then try: *"Use the feature_to_stories prompt for: let borrowers verify income by linking their bank account."*

### Inspect it

```bash
npm run inspect
```

opens the MCP Inspector so you can call each tool by hand.

## Design notes

- **Deterministic checks, not another LLM call.** The server uses rules and heuristics, so results are fast, free, repeatable and explainable. The assistant supplies the judgment; the server supplies the standard.
- **Logic separated from protocol.** `src/stories.ts` has no MCP dependency and is unit-tested on its own; `src/server.ts` is a thin wrapper that registers tools, a prompt and a resource.
- **Heuristics are opinionated on purpose.** They flag things worth a second look, not hard failures. Only a missing narrative or missing acceptance criteria makes a story "not ready".

## Roadmap

- Configurable rules (custom vague-word lists, point thresholds)
- Push stories directly to Jira or Azure DevOps
- Definition of Ready checklist per team

## License

MIT
