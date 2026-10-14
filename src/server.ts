#!/usr/bin/env node
/**
 * Backlog Buddy MCP server.
 *
 * Gives an AI assistant tools for turning feature ideas into well-formed user
 * stories: an INVEST checker, story-splitting suggestions, backlog export to
 * Markdown / CSV / Jira CSV, a guided "feature to stories" prompt, and a
 * reference guide.
 *
 * The assistant does the writing; these tools give it a product owner's
 * checklist to hold its drafts to.
 */
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import {
  exportBacklog,
  formatBacklogReport,
  formatSplits,
  formatStoryReport,
  INVEST_GUIDE,
  suggestSplits,
  validateBacklog,
  validateStory,
} from "./stories.js";

const VERSION = "0.1.0";
const GUIDE_URI = "backlogbuddy://guides/invest";

const storySchema = z.object({
  title: z.string().optional().describe("Short title, e.g. 'Link a bank account'"),
  narrative: z.string().describe("As a <persona>, I want <goal> so that <benefit>."),
  acceptanceCriteria: z
    .array(z.string())
    .optional()
    .describe("Acceptance criteria, ideally each in Given / When / Then form"),
  estimate: z.number().optional().describe("Story points, if estimated"),
  labels: z.array(z.string()).optional().describe("Labels or tags"),
});

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

export function createServer(): McpServer {
  const server = new McpServer({ name: "backlog-buddy", version: VERSION });

  server.registerTool(
    "validate_story",
    {
      title: "Check a user story",
      description:
        "Checks one user story against INVEST (Independent, Negotiable, Valuable, Estimable, Small, Testable) " +
        "and acceptance-criteria quality rules. Returns a 0–100 score, a verdict (ready / needs-work / not-ready) " +
        "and specific findings with suggested fixes. Use it on every story you draft before showing it to the user.",
      inputSchema: storySchema,
    },
    async (story) => text(formatStoryReport(validateStory(story))),
  );

  server.registerTool(
    "validate_backlog",
    {
      title: "Check a set of stories",
      description:
        "Checks several user stories at once: each gets an INVEST report, plus a summary with average score, " +
        "how many are ready, total points and possible duplicates.",
      inputSchema: z.object({
        stories: z.array(storySchema).min(1).describe("The stories to check"),
      }),
    },
    async ({ stories }) => text(formatBacklogReport(validateBacklog(stories))),
  );

  server.registerTool(
    "suggest_splits",
    {
      title: "Suggest ways to split a story",
      description:
        "Given a story or feature that is too big, suggests splitting patterns that fit it (workflow steps, " +
        "CRUD operations, business rules, data variations, interfaces, happy path first, defer performance, " +
        "user roles, spikes), each with how to apply it and an example.",
      inputSchema: z.object({
        text: z.string().describe("The story narrative, acceptance criteria or feature description to split"),
        maxSuggestions: z.number().int().min(1).max(9).optional().describe("How many patterns to return (default 5)"),
      }),
    },
    async ({ text: input, maxSuggestions }) => text(formatSplits(suggestSplits(input, maxSuggestions ?? 5))),
  );

  server.registerTool(
    "export_backlog",
    {
      title: "Export stories",
      description:
        "Formats finished stories as Markdown (for docs or a README), plain CSV (for spreadsheets), or " +
        "jira-csv (columns laid out for Jira's CSV importer: Summary, Issue Type, Description, Story Points, Labels).",
      inputSchema: z.object({
        stories: z.array(storySchema).min(1),
        format: z.enum(["markdown", "csv", "jira-csv"]).describe("Output format"),
        epic: z.string().optional().describe("Optional epic or feature name to group the stories under"),
      }),
    },
    async ({ stories, format, epic }) => text(exportBacklog(stories, format, epic)),
  );

  server.registerPrompt(
    "feature_to_stories",
    {
      title: "Turn a feature into user stories",
      description: "Guides the assistant from a feature brief to a checked, export-ready set of user stories.",
      argsSchema: z.object({
        feature: z.string().describe("The feature idea, brief or problem statement"),
        persona: z.string().optional().describe("Primary user or persona, if known"),
        constraints: z.string().optional().describe("Deadlines, compliance rules, systems involved, out-of-scope items"),
      }),
    },
    ({ feature, persona, constraints }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              "Act as an experienced product owner. Turn the feature below into a small backlog of user stories.",
              "",
              `Feature: ${feature}`,
              persona ? `Primary persona: ${persona}` : "",
              constraints ? `Constraints: ${constraints}` : "",
              "",
              "Work in this order:",
              "1. Ask up to three clarifying questions only if the answers would change the stories; otherwise state your assumptions.",
              "2. Draft 3–8 thin vertical slices. Each story needs a title, a narrative ('As a … I want … so that …'), " +
                "2–5 Given/When/Then acceptance criteria including at least one unhappy path, and labels.",
              "3. Run validate_backlog on the draft. For any story scoring below 80, revise it; if it's too big, use suggest_splits.",
              "4. Re-run validate_backlog until every story is ready, then present the stories in a suggested build order with a one-line reason for the order.",
              "5. Offer to export with export_backlog (markdown, csv or jira-csv).",
              "",
              `The reference guide at ${GUIDE_URI} explains the standards being checked.`,
            ]
              .filter((l, i, arr) => !(l === "" && arr[i - 1] === ""))
              .join("\n"),
          },
        },
      ],
    }),
  );

  server.registerResource(
    "invest-guide",
    GUIDE_URI,
    {
      title: "Writing good user stories",
      description: "INVEST, acceptance criteria and story splitting, in one page",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "text/markdown", text: INVEST_GUIDE }],
    }),
  );

  return server;
}

async function main() {
  const server = createServer();
  await server.connect(new StdioServerTransport());
  // stdout carries the protocol, so log to stderr only.
  console.error(`backlog-buddy MCP server v${VERSION} running on stdio`);
}

main().catch((err) => {
  console.error("backlog-buddy failed to start:", err);
  process.exit(1);
});
