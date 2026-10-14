import { test } from "node:test";
import assert from "node:assert/strict";
import {
  exportBacklog,
  formatBacklogReport,
  formatStoryReport,
  parseNarrative,
  suggestSplits,
  validateBacklog,
  validateStory,
  type Story,
} from "../src/stories.js";

const good: Story = {
  title: "Link a checking account",
  narrative:
    "As a first-time borrower, I want to link my checking account so that the lender can verify my income without paper statements.",
  acceptanceCriteria: [
    "Given I am on the income step, when I choose to link an account and sign in at my bank, then my checking account appears as linked",
    "Given my bank sign-in fails, when I return to the app, then I see the reason and can retry or upload statements instead",
    "Given I have linked an account, when I view the income step, then I see the institution name and last four digits only",
  ],
  estimate: 5,
  labels: ["onboarding", "open banking"],
};

test("parses the As a / I want / so that narrative", () => {
  assert.deepEqual(parseNarrative(good.narrative), {
    persona: "first-time borrower",
    goal: "link my checking account",
    benefit: "the lender can verify my income without paper statements",
  });
  assert.equal(parseNarrative("As an admin, I can reset passwords.").persona, "admin");
  assert.deepEqual(parseNarrative("Build the login page"), {});
});

test("a well-formed story is ready with no findings", () => {
  const r = validateStory(good);
  assert.equal(r.verdict, "ready");
  assert.equal(r.score, 100);
  assert.deepEqual(r.findings, []);
  assert.ok(Object.values(r.invest).every((v) => v === "pass"));
});

test("missing acceptance criteria makes a story not ready", () => {
  const r = validateStory({ narrative: "As a teacher, I want to log a session so that the IEP record is current." });
  assert.equal(r.verdict, "not-ready");
  assert.equal(r.invest.T, "fail");
  assert.ok(r.findings.some((f) => f.severity === "error" && f.invest === "T"));
});

test("flags vague terms, missing benefit, generic persona and compound goals", () => {
  const r = validateStory({
    narrative: "As a user, I want to search and export transactions quickly",
    acceptanceCriteria: ["Search should be fast and intuitive"],
  });
  const msgs = r.findings.map((f) => f.message).join("\n");
  assert.match(msgs, /no 'so that' clause/);
  assert.match(msgs, /generic/);
  assert.match(msgs, /"and"/);
  assert.match(msgs, /"quickly"/);
  assert.match(msgs, /"fast"/);
  assert.match(msgs, /"intuitive"/);
  assert.equal(r.verdict, "needs-work");
  assert.ok(r.score < 80);
});

test("does not flag vague words inside other words", () => {
  // "some" is vague, but "awesome" and "handsome" must not trigger it; "fast" must not match "breakfast".
  const r = validateStory({
    ...good,
    narrative: "As a cafe owner, I want to post the breakfast menu so that awesome regulars know what's on.",
  });
  assert.ok(!r.findings.some((f) => /Vague/.test(f.message)), JSON.stringify(r.findings));
});

test("flags dependencies, big estimates, too many criteria and implementation detail", () => {
  const r = validateStory({
    narrative: "As a case manager, I want a dropdown in the database form so that I can pick a service. Depends on story 12.",
    acceptanceCriteria: Array.from({ length: 9 }, (_, i) => `Given step ${i}, when it runs, then it is invalid`),
    estimate: 13,
  });
  const by = (l: string) => r.findings.filter((f) => f.invest === l).map((f) => f.message).join(" ");
  assert.match(by("I"), /dependency/);
  assert.match(by("S"), /13 points/);
  assert.match(by("S"), /9 acceptance criteria/);
  assert.match(by("N"), /dropdown/);
  assert.match(by("N"), /database/);
});

test("notes when every criterion is happy path", () => {
  const r = validateStory({
    ...good,
    acceptanceCriteria: [
      "Given I am signed in, when I open history, then I see transactions",
      "Given I have transactions, when I tap one, then I see its details",
    ],
  });
  assert.ok(r.findings.some((f) => /happy path/.test(f.message)));
});

test("backlog summary counts verdicts, totals points and finds duplicates", () => {
  const b = validateBacklog([
    good,
    { ...good, title: "Link a Checking Account!" },
    { narrative: "As a teacher, I want to log a session so that records are current." },
  ]);
  assert.equal(b.storyCount, 3);
  assert.equal(b.ready, 2);
  assert.equal(b.notReady, 1);
  assert.equal(b.totalPoints, 10);
  assert.equal(b.duplicates.length, 1);
  assert.match(formatBacklogReport(b), /Possible duplicates/);
});

test("suggests relevant split patterns", () => {
  const ids = suggestSplits(
    "As an admin I want to manage payees on web and mobile, with validation rules for each country, in real time",
  ).map((s) => s.id);
  assert.ok(ids.includes("operations"));
  assert.ok(ids.includes("interfaces") || ids.includes("data-variations"));
  assert.ok(ids.length <= 5);
  // Falls back to general patterns when there is no signal.
  const fallback = suggestSplits("Zebra");
  assert.equal(fallback.length, 3);
  assert.match(fallback[0].reason, /General-purpose/);
});

test("exports markdown", () => {
  const md = exportBacklog([good], "markdown", "Income verification");
  assert.match(md, /^# Income verification/);
  assert.match(md, /## 1\. Link a checking account/);
  assert.match(md, /_5 pts · `onboarding` `open banking`_/);
  assert.match(md, /- \[ \] Given my bank sign-in fails/);
});

test("exports CSV with quoting of commas, quotes and newlines", () => {
  const csv = exportBacklog([{ ...good, title: 'Link "primary", account' }], "csv");
  const [header, row] = csv.split("\r\n");
  assert.equal(header, "Title,Narrative,Acceptance Criteria,Estimate,Labels,Epic");
  assert.ok(row.startsWith('"Link ""primary"", account",'));
  assert.ok(csv.includes("\nGiven my bank sign-in fails")); // criteria joined by newline inside one quoted cell
});

test("exports Jira CSV with repeated Labels columns and no spaces in labels", () => {
  const csv = exportBacklog([good, { narrative: "As a teller, I want X so that Y." }], "jira-csv", "Income");
  const header = csv.split("\r\n")[0];
  assert.equal(header, "Summary,Issue Type,Description,Story Points,Labels,Labels,Epic Name");
  assert.ok(csv.includes(",onboarding,open-banking,Income"));
  assert.ok(csv.includes("h3. Acceptance Criteria"));
});

test("report formatting includes score, INVEST row and suggestions", () => {
  const out = formatStoryReport(validateStory({ narrative: "Make login fast" }));
  assert.match(out, /\/100 \(not-ready\)/);
  assert.match(out, /Independent/);
  assert.match(out, /Testable/);
});
