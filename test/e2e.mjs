// End-to-end check: starts the built server over stdio with a real MCP client
// and exercises every tool, the prompt and the resource.
// Run with:  npm run build && npm run e2e
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const serverPath = fileURLToPath(new URL("../dist/server.js", import.meta.url));
const client = new Client({ name: "backlog-buddy-e2e", version: "1.0.0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [serverPath] }));

const story = {
  title: "Link a checking account",
  narrative: "As a first-time borrower, I want to link my checking account so that the lender can verify my income.",
  acceptanceCriteria: [
    "Given I am on the income step, when I link an account, then it appears as linked",
    "Given my bank sign-in fails, when I return, then I can retry or upload statements",
  ],
  estimate: 5,
  labels: ["onboarding"],
};

const textOf = (r) => r.content.map((c) => c.text).join("\n");
const pass = (name) => console.log(`  ✔ ${name}`);

const { tools } = await client.listTools();
assert.deepEqual(tools.map((t) => t.name).sort(), ["export_backlog", "suggest_splits", "validate_backlog", "validate_story"]);
pass(`lists ${tools.length} tools`);

let r = await client.callTool({ name: "validate_story", arguments: story });
assert.match(textOf(r), /100\/100 \(ready\)/);
pass("validate_story");

r = await client.callTool({ name: "validate_backlog", arguments: { stories: [story, { narrative: "Make it fast" }] } });
assert.match(textOf(r), /2 stories/);
pass("validate_backlog");

r = await client.callTool({ name: "suggest_splits", arguments: { text: "Manage payees on web and mobile", maxSuggestions: 2 } });
assert.match(textOf(r), /^1\. \*\*/);
pass("suggest_splits");

r = await client.callTool({ name: "export_backlog", arguments: { stories: [story], format: "jira-csv" } });
assert.match(textOf(r), /^Summary,Issue Type,Description,Story Points,Labels/);
pass("export_backlog");

const { prompts } = await client.listPrompts();
assert.equal(prompts[0].name, "feature_to_stories");
const p = await client.getPrompt({ name: "feature_to_stories", arguments: { feature: "Let borrowers verify income by linking a bank account" } });
assert.match(p.messages[0].content.text, /validate_backlog/);
pass("feature_to_stories prompt");

const { resources } = await client.listResources();
const res = await client.readResource({ uri: resources[0].uri });
assert.match(res.contents[0].text, /INVEST/);
pass("invest guide resource");

await client.close();
console.log("All end-to-end checks passed.");
