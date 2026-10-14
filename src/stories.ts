/**
 * Backlog Buddy — core logic.
 *
 * Everything in this file is plain TypeScript with no MCP dependency, so it can be
 * unit-tested on its own. server.ts wraps these functions as MCP tools.
 */

export interface Story {
  /** Short title, e.g. "Link a bank account". */
  title?: string;
  /** The narrative: "As a <persona>, I want <goal> so that <benefit>." */
  narrative: string;
  /** Acceptance criteria, ideally in Given / When / Then form. */
  acceptanceCriteria?: string[];
  /** Story points (optional). */
  estimate?: number;
  /** Free-form labels, e.g. ["onboarding", "mvp"]. */
  labels?: string[];
}

export type Severity = "error" | "warning" | "info";
export type InvestLetter = "I" | "N" | "V" | "E" | "S" | "T";

export interface Finding {
  severity: Severity;
  /** Which INVEST quality the finding relates to. */
  invest: InvestLetter;
  message: string;
  suggestion?: string;
}

export interface StoryReport {
  title: string;
  score: number;
  verdict: "ready" | "needs-work" | "not-ready";
  parsed: { persona?: string; goal?: string; benefit?: string };
  invest: Record<InvestLetter, "pass" | "warn" | "fail">;
  findings: Finding[];
}

export const INVEST_NAMES: Record<InvestLetter, string> = {
  I: "Independent",
  N: "Negotiable",
  V: "Valuable",
  E: "Estimable",
  S: "Small",
  T: "Testable",
};

/** Words that make a requirement hard to test because nobody can agree when they're met. */
export const VAGUE_TERMS = [
  "fast",
  "quick",
  "quickly",
  "easy",
  "easily",
  "simple",
  "user-friendly",
  "user friendly",
  "intuitive",
  "seamless",
  "seamlessly",
  "efficient",
  "robust",
  "flexible",
  "scalable",
  "modern",
  "appropriate",
  "as needed",
  "as appropriate",
  "etc",
  "and so on",
  "tbd",
  "approximately",
  "some",
  "various",
  "better",
  "improved",
  "optimal",
  "minimal",
];

/** Signals that the story describes a solution rather than a need. */
const IMPLEMENTATION_TERMS = [
  "database",
  "table",
  "column",
  "endpoint",
  "microservice",
  "dropdown",
  "drop-down",
  "modal",
  "button",
  "react",
  "sql",
  "json",
  "lambda",
  "kafka",
  "cron",
];

const GENERIC_PERSONAS = ["user", "the user", "a user", "someone", "person", "customer"];

const NARRATIVE_RE =
  /^\s*as\s+(?:an?|the)?\s*(?<persona>.+?)\s*,?\s+i\s+(?:want|need|would like|can|should be able)\s+(?:to\s+)?(?<goal>.+?)(?:\s*,?\s+so\s+(?:that\s+)?(?<benefit>.+?))?\s*\.?\s*$/is;

const GWT_RE = /\bgiven\b[\s\S]*\bwhen\b[\s\S]*\bthen\b/i;
const DEPENDENCY_RE = /\b(depends on|dependent on|blocked by|after (?:story|ticket)|requires story|once .* is (?:done|complete))\b/i;

function findTerms(text: string, terms: string[]): string[] {
  const lower = text.toLowerCase();
  return terms.filter((t) => {
    const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`, "i").test(lower);
  });
}

export function parseNarrative(narrative: string): StoryReport["parsed"] {
  const m = NARRATIVE_RE.exec(narrative.trim());
  if (!m?.groups) return {};
  return {
    persona: m.groups.persona?.trim(),
    goal: m.groups.goal?.trim(),
    benefit: m.groups.benefit?.trim(),
  };
}

const PENALTY: Record<Severity, number> = { error: 25, warning: 10, info: 3 };

/** Check one story against INVEST heuristics and acceptance-criteria quality rules. */
export function validateStory(story: Story): StoryReport {
  const findings: Finding[] = [];
  const add = (severity: Severity, invest: InvestLetter, message: string, suggestion?: string) =>
    findings.push({ severity, invest, message, suggestion });

  const narrative = (story.narrative ?? "").trim();
  const criteria = (story.acceptanceCriteria ?? []).map((c) => c.trim()).filter(Boolean);
  const parsed = parseNarrative(narrative);

  // --- Narrative structure (Valuable / Negotiable) ---
  if (!narrative) {
    add("error", "V", "The story has no narrative.", 'Write it as "As a <persona>, I want <goal> so that <benefit>."');
  } else if (!parsed.persona || !parsed.goal) {
    add(
      "warning",
      "V",
      "The narrative doesn't follow the 'As a … I want … so that …' pattern.",
      "The pattern isn't mandatory, but it forces you to name who benefits and why.",
    );
  } else {
    if (!parsed.benefit) {
      add(
        "warning",
        "V",
        "There's no 'so that' clause, so the value to the user is implied rather than stated.",
        "Add the outcome the persona gets. It's what lets the team negotiate scope without losing the point.",
      );
    }
    if (GENERIC_PERSONAS.includes(parsed.persona.toLowerCase())) {
      add(
        "info",
        "V",
        `The persona "${parsed.persona}" is generic.`,
        "Name a specific role (e.g. 'first-time borrower', 'branch teller', 'case manager') so the team can picture the need.",
      );
    }
    const goalConjunctions = parsed.goal.match(/\b(and|or|as well as|plus)\b/gi);
    if (goalConjunctions && goalConjunctions.length > 0) {
      add(
        "warning",
        "S",
        `The goal contains "${goalConjunctions[0]}", which often means two stories in one.`,
        "Check whether each part could ship and deliver value on its own. If so, split them.",
      );
    }
  }

  const impl = findTerms(narrative, IMPLEMENTATION_TERMS);
  if (impl.length) {
    add(
      "info",
      "N",
      `The narrative names implementation details (${impl.join(", ")}).`,
      "Describe the need and leave the solution open for the team, unless the persona really is technical.",
    );
  }

  // --- Independence ---
  const allText = [narrative, ...criteria].join("\n");
  if (DEPENDENCY_RE.test(allText)) {
    add(
      "warning",
      "I",
      "The story references a dependency on other work.",
      "Try reordering or re-slicing so this story can be built and released on its own.",
    );
  }

  // --- Acceptance criteria (Testable / Estimable) ---
  if (criteria.length === 0) {
    add(
      "error",
      "T",
      "There are no acceptance criteria.",
      "Add 2–5 criteria in Given / When / Then form, including at least one unhappy path.",
    );
    add("warning", "E", "Without acceptance criteria the team has little to estimate against.");
  } else {
    const nonGwt = criteria.filter((c) => !GWT_RE.test(c));
    if (nonGwt.length) {
      add(
        "info",
        "T",
        `${nonGwt.length} of ${criteria.length} acceptance criteria aren't in Given / When / Then form.`,
        "Given/When/Then makes each criterion read as a test case, which helps QA and automation.",
      );
    }
    const unhappy = criteria.some((c) =>
      /\b(invalid|error|fail|fails|failed|denied|declin|timeout|times out|missing|empty|not |cannot|can't|unable|expired|locked|duplicate)\b/i.test(c),
    );
    if (criteria.length >= 2 && !unhappy) {
      add(
        "info",
        "T",
        "All acceptance criteria describe the happy path.",
        "Add at least one criterion for what happens when something goes wrong.",
      );
    }
    if (criteria.length > 8) {
      add(
        "warning",
        "S",
        `There are ${criteria.length} acceptance criteria, which usually means the story is too big.`,
        "Group the criteria by theme; each group is a candidate story.",
      );
    }
  }

  const vague = findTerms(allText, VAGUE_TERMS);
  if (vague.length) {
    add(
      "warning",
      "T",
      `Vague terms make this hard to test: ${vague.map((v) => `"${v}"`).join(", ")}.`,
      "Replace each with something measurable (e.g. 'fast' → 'within 2 seconds for 95% of requests').",
    );
  }

  // --- Size ---
  if (typeof story.estimate === "number") {
    if (story.estimate > 8) {
      add(
        "warning",
        "S",
        `An estimate of ${story.estimate} points is large for a single story.`,
        "Most teams aim to finish a story in a few days. Use suggest_splits to find a slice.",
      );
    }
    if (story.estimate <= 0) add("info", "E", "The estimate is zero or negative.");
  }

  // --- Score and per-letter status ---
  const score = Math.max(0, 100 - findings.reduce((sum, f) => sum + PENALTY[f.severity], 0));
  const invest = (Object.keys(INVEST_NAMES) as InvestLetter[]).reduce(
    (acc, letter) => {
      const fs = findings.filter((f) => f.invest === letter);
      acc[letter] = fs.some((f) => f.severity === "error")
        ? "fail"
        : fs.some((f) => f.severity === "warning")
          ? "warn"
          : "pass";
      return acc;
    },
    {} as Record<InvestLetter, "pass" | "warn" | "fail">,
  );
  const hasError = findings.some((f) => f.severity === "error");
  const verdict: StoryReport["verdict"] = hasError ? "not-ready" : score >= 80 ? "ready" : "needs-work";

  return {
    title: story.title?.trim() || parsed.goal || narrative.slice(0, 60) || "(untitled)",
    score,
    verdict,
    parsed,
    invest,
    findings,
  };
}

export interface BacklogReport {
  storyCount: number;
  averageScore: number;
  ready: number;
  needsWork: number;
  notReady: number;
  totalPoints: number;
  duplicates: string[][];
  stories: StoryReport[];
}

function normalizeForCompare(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

/** Validate a set of stories and look for duplicates across them. */
export function validateBacklog(stories: Story[]): BacklogReport {
  const reports = stories.map(validateStory);
  const groups = new Map<string, string[]>();
  reports.forEach((r, i) => {
    const key = normalizeForCompare(stories[i].title || parseNarrative(stories[i].narrative).goal || stories[i].narrative);
    groups.set(key, [...(groups.get(key) ?? []), r.title]);
  });
  const count = (v: StoryReport["verdict"]) => reports.filter((r) => r.verdict === v).length;
  return {
    storyCount: reports.length,
    averageScore: reports.length ? Math.round(reports.reduce((s, r) => s + r.score, 0) / reports.length) : 0,
    ready: count("ready"),
    needsWork: count("needs-work"),
    notReady: count("not-ready"),
    totalPoints: stories.reduce((s, st) => s + (typeof st.estimate === "number" ? st.estimate : 0), 0),
    duplicates: [...groups.values()].filter((g) => g.length > 1),
    stories: reports,
  };
}

// ---------------------------------------------------------------------------
// Story splitting
// ---------------------------------------------------------------------------

export interface SplitPattern {
  id: string;
  name: string;
  /** Why this pattern was suggested for this story. */
  reason: string;
  howTo: string;
  example: string;
}

interface PatternDef {
  id: string;
  name: string;
  triggers: RegExp;
  reason: string;
  howTo: string;
  example: string;
}

/**
 * Patterns adapted from common agile practice (Richard Lawrence's story-splitting
 * patterns and Mike Cohn's SPIDR). Each has a trigger that suggests it applies.
 */
const PATTERNS: PatternDef[] = [
  {
    id: "workflow-steps",
    name: "Workflow steps",
    triggers: /\b(then|after that|next|steps?|process|flow|wizard|onboard\w*|checkout|sign[- ]?up|apply|application)\b/i,
    reason: "The story describes a multi-step process.",
    howTo: "Deliver the simplest end-to-end path first, then add the middle steps one story at a time.",
    example: "Ship 'apply for a loan with only required fields' before 'save and resume an application'.",
  },
  {
    id: "operations",
    name: "Operations (CRUD)",
    triggers: /\b(manage|maintain|administer|crud|create|edit|update|delete|remove|add)\b/i,
    reason: "The story covers several operations on the same thing.",
    howTo: "Split by operation: create, view, edit, delete. View or create usually comes first.",
    example: "'Manage payees' becomes 'add a payee', 'edit a payee' and 'remove a payee'.",
  },
  {
    id: "business-rules",
    name: "Business rule variations",
    triggers: /\b(rules?|policy|policies|eligib\w*|validat\w*|limit|threshold|depending|based on|if|unless|calculat\w*)\b/i,
    reason: "The story hides several business rules.",
    howTo: "Implement the most common rule first; add each additional rule or exception as its own story.",
    example: "Approve transfers under the daily limit first; handle over-limit review in a later story.",
  },
  {
    id: "data-variations",
    name: "Data variations",
    triggers: /\b(types?|formats?|currenc\w*|languages?|countr\w*|states?|accounts?|institutions?|banks?|file|csv|pdf|all)\b/i,
    reason: "The story handles several kinds of data.",
    howTo: "Support one data type, format or source first, then add the rest.",
    example: "Import checking accounts first; savings, credit cards and loans follow.",
  },
  {
    id: "interfaces",
    name: "Interfaces / channels",
    triggers: /\b(mobile|web|app|ios|android|desktop|tablet|browser|api|sms|email|channel|platforms?)\b/i,
    reason: "The story spans more than one interface or channel.",
    howTo: "Deliver on one channel first, or with a plain interface before a polished one.",
    example: "Enable on web first; mobile follows once the flow is proven.",
  },
  {
    id: "happy-unhappy",
    name: "Happy path first",
    triggers: /\b(error|fail\w*|invalid|exception|retry|edge case|timeout|declin\w*)\b/i,
    reason: "The story mixes the main flow with error handling.",
    howTo: "Deliver the happy path with basic error handling; add each recovery path as its own story.",
    example: "Link an account successfully first; handle MFA challenges and expired credentials next.",
  },
  {
    id: "performance",
    name: "Defer performance",
    triggers: /\b(fast|quick\w*|performan\w*|real[- ]?time|scal\w*|seconds?|latency|load|volume|concurren\w*)\b/i,
    reason: "The story bundles a performance requirement with the feature.",
    howTo: "Make it work first, then make it fast in a follow-up story with a measurable target.",
    example: "Show transaction history (any speed), then 'history loads in under 2s for 1,000 transactions'.",
  },
  {
    id: "spike",
    name: "Spike",
    triggers: /\b(investigate|research|explore|unknown|unclear|new vendor|integrat\w*|third[- ]party|prototype|feasib\w*)\b/i,
    reason: "There's uncertainty that makes the story hard to estimate.",
    howTo: "Time-box a spike to answer the open questions, then write the real stories with what you learned.",
    example: "Two-day spike on the aggregator's sandbox before estimating the account-linking stories.",
  },
  {
    id: "roles",
    name: "User roles",
    triggers: /\b(admins?|administrators?|managers?|roles?|permissions?|users and|staff|teachers?|providers?|members?)\b/i,
    reason: "The story serves more than one type of user.",
    howTo: "Deliver for the primary role first; add other roles and their permissions as separate stories.",
    example: "Let case managers log services first; supervisor review comes in a later story.",
  },
];

const FALLBACK: PatternDef[] = PATTERNS.filter((p) => ["workflow-steps", "happy-unhappy", "business-rules"].includes(p.id));

/** Suggest ways to split a story that is too big. */
export function suggestSplits(text: string, max = 5): SplitPattern[] {
  const hits = PATTERNS.filter((p) => p.triggers.test(text));
  const chosen = (hits.length ? hits : FALLBACK).slice(0, Math.max(1, max));
  return chosen.map(({ id, name, reason, howTo, example }) => ({
    id,
    name,
    reason: hits.length ? reason : "General-purpose pattern (no specific signal found in the text).",
    howTo,
    example,
  }));
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export type ExportFormat = "markdown" | "csv" | "jira-csv";

function csvCell(value: string | number | undefined): string {
  const s = value === undefined ? "" : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvRow(cells: (string | number | undefined)[]): string {
  return cells.map(csvCell).join(",");
}

function storyTitle(s: Story): string {
  return s.title?.trim() || parseNarrative(s.narrative).goal || s.narrative.trim().slice(0, 80);
}

/** Render stories as Markdown, a plain CSV, or a CSV laid out for Jira's CSV importer. */
export function exportBacklog(stories: Story[], format: ExportFormat, epic?: string): string {
  if (format === "markdown") {
    const lines: string[] = [];
    if (epic) lines.push(`# ${epic}`, "");
    stories.forEach((s, i) => {
      const meta = [
        typeof s.estimate === "number" ? `${s.estimate} pts` : undefined,
        s.labels?.length ? s.labels.map((l) => `\`${l}\``).join(" ") : undefined,
      ].filter(Boolean);
      lines.push(`## ${i + 1}. ${storyTitle(s)}`, "");
      if (meta.length) lines.push(`_${meta.join(" · ")}_`, "");
      lines.push(s.narrative.trim(), "");
      if (s.acceptanceCriteria?.length) {
        lines.push("**Acceptance criteria**", "");
        s.acceptanceCriteria.forEach((c) => lines.push(`- [ ] ${c.trim()}`));
        lines.push("");
      }
    });
    return lines.join("\n").trimEnd() + "\n";
  }

  if (format === "csv") {
    const rows = [csvRow(["Title", "Narrative", "Acceptance Criteria", "Estimate", "Labels", "Epic"])];
    for (const s of stories) {
      rows.push(
        csvRow([
          storyTitle(s),
          s.narrative.trim(),
          (s.acceptanceCriteria ?? []).join("\n"),
          s.estimate,
          (s.labels ?? []).join(";"),
          epic,
        ]),
      );
    }
    return rows.join("\r\n") + "\r\n";
  }

  // Jira's importer maps columns by name during import; repeated "Labels" columns
  // become multiple labels, and labels can't contain spaces.
  const maxLabels = Math.max(0, ...stories.map((s) => s.labels?.length ?? 0));
  const header = ["Summary", "Issue Type", "Description", "Story Points", ...Array(maxLabels).fill("Labels")];
  if (epic) header.push("Epic Name");
  const rows = [csvRow(header)];
  for (const s of stories) {
    const description = [
      s.narrative.trim(),
      ...(s.acceptanceCriteria?.length ? ["", "h3. Acceptance Criteria", ...s.acceptanceCriteria.map((c) => `* ${c.trim()}`)] : []),
    ].join("\n");
    const labels = (s.labels ?? []).map((l) => l.trim().replace(/\s+/g, "-"));
    const row: (string | number | undefined)[] = [
      storyTitle(s),
      "Story",
      description,
      s.estimate,
      ...Array.from({ length: maxLabels }, (_, i) => labels[i]),
    ];
    if (epic) row.push(epic);
    rows.push(csvRow(row));
  }
  return rows.join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------------
// Human-readable report formatting (what the AI client shows the user)
// ---------------------------------------------------------------------------

const ICON: Record<"pass" | "warn" | "fail", string> = { pass: "✅", warn: "⚠️", fail: "❌" };

export function formatStoryReport(r: StoryReport): string {
  const letters = (Object.keys(INVEST_NAMES) as InvestLetter[])
    .map((l) => `${ICON[r.invest[l]]} ${INVEST_NAMES[l]}`)
    .join("  ");
  const lines = [`### ${r.title} — ${r.score}/100 (${r.verdict})`, "", letters, ""];
  if (r.findings.length === 0) {
    lines.push("No issues found.");
  } else {
    for (const f of r.findings) {
      lines.push(`- **${f.severity}** [${INVEST_NAMES[f.invest]}] ${f.message}${f.suggestion ? ` _${f.suggestion}_` : ""}`);
    }
  }
  return lines.join("\n");
}

export function formatBacklogReport(b: BacklogReport): string {
  const lines = [
    `## Backlog check: ${b.storyCount} stories, average ${b.averageScore}/100`,
    "",
    `Ready: ${b.ready} · Needs work: ${b.needsWork} · Not ready: ${b.notReady}` +
      (b.totalPoints ? ` · Total estimate: ${b.totalPoints} pts` : ""),
  ];
  if (b.duplicates.length) {
    lines.push("", "**Possible duplicates:**", ...b.duplicates.map((g) => `- ${g.join(" / ")}`));
  }
  lines.push("", ...b.stories.map(formatStoryReport).flatMap((s) => [s, ""]));
  return lines.join("\n").trimEnd();
}

export function formatSplits(splits: SplitPattern[]): string {
  return splits
    .map((s, i) => `${i + 1}. **${s.name}** — ${s.reason}\n   - How: ${s.howTo}\n   - Example: ${s.example}`)
    .join("\n");
}

// ---------------------------------------------------------------------------
// Reference guide (served as an MCP resource)
// ---------------------------------------------------------------------------

export const INVEST_GUIDE = `# Writing good user stories

## The format
> As a **<specific persona>**, I want **<goal>** so that **<benefit>**.

The persona says who you're building for, the goal says what they need, and the
benefit says why it matters. The benefit is what lets the team negotiate scope
without losing the point.

## INVEST
| Letter | Quality | Ask yourself |
|---|---|---|
| I | Independent | Can this be built and released without waiting on another story? |
| N | Negotiable | Does it describe a need, leaving the solution open for discussion? |
| V | Valuable | Would a user or the business notice if it shipped? |
| E | Estimable | Does the team understand it well enough to size it? |
| S | Small | Can it be finished within a few days, well inside one sprint? |
| T | Testable | Is there an objective way to say it's done? |

## Acceptance criteria
Write 2–5 criteria per story in Given / When / Then form, and include at least
one unhappy path.

> **Given** a customer with a linked checking account
> **When** they request a transfer above their daily limit
> **Then** the transfer is held for review and they see the limit and next steps

Avoid words nobody can test: fast, easy, intuitive, seamless, robust, etc.
Replace them with numbers or observable behavior.

## When a story is too big
Split it so each slice still delivers value end to end (a thin vertical slice,
not a layer). Common patterns: workflow steps, operations (CRUD), business rule
variations, data variations, interfaces, happy path first, defer performance,
user roles, and spikes for unknowns.
`;
