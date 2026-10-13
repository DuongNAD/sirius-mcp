/**
 * Sirius MCP: execution loop of the learning hub (deadline sentinel, triage, today router,
 * implementation intentions, session timer, weekly plan-vs-actual review).
 *
 *   node dist/sirius.mjs                              -> MCP server on stdio
 *   node dist/sirius.mjs deadlines [--detail]         -> CLI deadline sentinel
 *   node dist/sirius.mjs today [YYYY-MM-DD]           -> CLI today router
 *   node dist/sirius.mjs triage suggest|list|record   -> CLI triage of overdue tasks
 *   node dist/sirius.mjs commit|start|stop|log ...    -> CLI commitments and sessions
 *   node dist/sirius.mjs week [YYYY-MM-DD] [--write]  -> CLI weekly review
 *   node dist/sirius.mjs stats [--weeks n]            -> CLI statistics
 *   node dist/sirius.mjs guide [topic]                -> CLI guide
 *   node dist/sirius.mjs version | help
 */
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { runDeadlines } from "./deadlines.js";
import { GUIDE_TOPICS, getGuideTopic } from "./guide.js";
import { runCommit, runLog, runStart, runStop } from "./journal.js";
import { OUTCOMES, SESSION_KINDS, TriageDecisionInputSchema, type OpResult } from "./schema.js";
import { runToday } from "./today.js";
import { runTriage } from "./triage.js";
import { errMsg, VERSION } from "./util.js";
import { runStats, runWeek } from "./week.js";

export * from "./deadlines.js";
export * from "./evidence.js";
export * from "./guide.js";
export * from "./hub.js";
export * from "./journal.js";
export * from "./plan.js";
export * from "./schema.js";
export * from "./smartdrive.js";
export * from "./today.js";
export * from "./triage.js";
export * from "./util.js";
export * from "./week.js";

type Content = { type: "text"; text: string };
type ToolResult = { content: Content[]; isError?: boolean };

const text = (t: string, isError = false): ToolResult => ({
  content: [{ type: "text", text: t }],
  ...(isError ? { isError: true } : {}),
});

async function safe(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await fn();
  } catch (e) {
    return text(errMsg(e), true);
  }
}

export const INSTRUCTIONS = `Sirius MCP is the execution loop of the learning hub: deadline sentinel, task triage, today router, implementation intentions, session timer, and weekly plan-vs-actual review. Named after the star whose rising set the ancient Egyptian calendar: Sirius keeps time and watches deadlines.

Workflow:
1. At session start run sirius_deadlines: warn about overdue items before anything else; for items under 24 hours state the exact countdown and give a focus plan.
2. sirius_today to route the day: deadline priorities, weekly template, due reviews, commitments, next step per subject.
3. sirius_commit to turn the plan into an if-then commitment (time, place, first concrete action, minutes).
4. sirius_start before studying and sirius_stop after; sirius_log for sessions that were not timed.
5. sirius_triage { action: "suggest" }, show the suggestions to the learner, then record ONLY the decisions the learner confirmed in chat.
6. On Sunday run sirius_week { write: true } for the plan-vs-actual review; sirius_stats for trends.

Rules:
- Never edit TASKS.md, ACTIVE_LEARNING.md, INDEX.md, roadmaps or any learner file: Sirius only reads them. Its state lives in <hub>/.sirius/; the only other write is the optional weekly review file.
- Record only what the learner did or decided; nothing is inferred or invented. Evidence from Vega, Orion, Aurora, Mira, Polaris, Rigel and git is read-only: Sirius only counts it and never logs query text.
- Learner-facing text in Vietnamese with correct diacritics, no emoji.
- No recursive scans of D:; find labs and progress files through the SmartDrive index or SIRIUS_EVIDENCE_DIRS.
- Personal data in <hub>/.sirius/ stays local and git-ignored.

Done when:
Deadlines are checked at session start, overdue items are triaged with the learner's confirmation, sessions and commitments are recorded, and the weekly review compares the plan with the time actually spent.`;

const hubField = z
  .string()
  .optional()
  .describe("Hub folder (default: SIRIUS_HUB, then POLARIS_HUB, then D:/02_Learning_Knowledge)");
const nowField = z
  .string()
  .optional()
  .describe("ISO 8601 time override, e.g. 2026-10-12T00:47:00+07:00 (default: SIRIUS_NOW, then the system clock). Mainly for tests.");

export function createServer(): McpServer {
  const server = new McpServer({ name: "sirius", version: VERSION }, { instructions: INSTRUCTIONS });

  /* 1. sirius_guide */
  server.registerTool(
    "sirius_guide",
    {
      title: "Sirius Guide & Documentation",
      description:
        "READ FIRST. Documentation on deadlines, triage, the master roadmap parser, sessions and commitments, the weekly review, evidence sources, and rules. No argument = index.",
      inputSchema: {
        topic: z.enum(GUIDE_TOPICS).optional().describe(`Topic: ${GUIDE_TOPICS.join(" | ")}`),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ topic }) => safe(async () => text(getGuideTopic(topic))),
  );

  /* 2. sirius_deadlines */
  server.registerTool(
    "sirius_deadlines",
    {
      title: "Deadline Sentinel",
      description:
        "Read-only. Deterministic version of the AGENTS.md deadline rule over ACTIVE_LEARNING.md and every TASKS.md board: overdue (warn first), under 24 h (exact countdown and focus plan), under 48 h, under 72 h, later, triaged items, format deviations, conflicting deadlines. Cross-board duplicates are merged. Run at the start of every session.",
      inputSchema: {
        hub: hubField,
        now: nowField,
        detail: z.boolean().optional().describe("List every overdue item instead of the 10 most recently due"),
        subject: z.string().optional().describe("Only this subject (name, folder or alias such as GCI, ML, PM)"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => safe(async () => text((await runDeadlines(args)).text)),
  );

  /* 3. sirius_triage */
  server.registerTool(
    "sirius_triage",
    {
      title: "Triage Overdue Tasks",
      description:
        'suggest (read-only): propose superseded / parked / active for each untriaged overdue task, with the replacing task when one is found. record: append the decisions the learner confirmed to <hub>/.sirius/journal.jsonl and refresh <hub>/.sirius/triage.json; never touches TASKS.md. list: latest decision per task id plus orphaned decisions. IMPORTANT: show the suggestions to the learner and record only decisions the learner confirmed in chat.',
      inputSchema: {
        action: z.enum(["suggest", "record", "list"]).describe("suggest | record | list"),
        hub: hubField,
        now: nowField,
        before: z
          .string()
          .optional()
          .describe("suggest only: YYYY-MM-DD; overdue tasks due before this date are suggested as superseded (belong to the previous plan)"),
        decisions: z
          .array(z.looseObject(TriageDecisionInputSchema.shape))
          .optional()
          .describe("record only: [{ id, decision: superseded|parked|snoozed|active, until? (required for snoozed), replacedBy?, note? }]"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) => safe(async () => text((await runTriage(args)).text)),
  );

  /* 4. sirius_today */
  server.registerTool(
    "sirius_today",
    {
      title: "Today Router",
      description:
        "Read-only. Routes the day: deadline priorities first, the weekly template from Roadmaps/MASTER_ROADMAP.md (with this week's milestone and one next step per subject), due Vega cards and Polaris reviews, today's commitments, the running timer, and minutes studied so far versus the daily minimum.",
      inputSchema: {
        hub: hubField,
        now: nowField,
        date: z.string().optional().describe("YYYY-MM-DD (default: today)"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => safe(async () => text((await runToday(args)).text)),
  );

  /* 5. sirius_commit */
  server.registerTool(
    "sirius_commit",
    {
      title: "Record an If-Then Commitment",
      description:
        'Record an implementation intention: "When <time> at <place>, I will <first concrete action> for <N> minutes." Only what the learner states is recorded.',
      inputSchema: {
        subject: z.string().min(1).describe("Subject name, folder or alias"),
        time: z.string().min(1).describe("HH:mm"),
        action: z.string().min(1).describe("The first concrete step, startable immediately"),
        minutes: z.number().int().min(5).describe("Planned minutes (>= 5)"),
        where: z.string().optional().describe("Place"),
        date: z.string().optional().describe("YYYY-MM-DD (default: today)"),
        hub: hubField,
        now: nowField,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) => safe(async () => text((await runCommit(args)).text)),
  );

  /* 6. sirius_start */
  server.registerTool(
    "sirius_start",
    {
      title: "Start a Timed Study Session",
      description:
        "Start the session timer (writes <hub>/.sirius/active.json). Fails if a session is already running. Call sirius_stop when finished.",
      inputSchema: {
        subject: z.string().min(1).describe("Subject name, folder or alias"),
        estimate_minutes: z.number().int().min(1).describe("Estimated minutes for this session"),
        task: z.string().optional().describe("Free text or a task id"),
        kind: z.enum(SESSION_KINDS).optional().describe("learn (default) | practice | review | homework | project | meta"),
        commit_id: z.string().optional().describe("Commitment id from sirius_commit"),
        hub: hubField,
        now: nowField,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) => safe(async () => text((await runStart(args)).text)),
  );

  /* 7. sirius_stop */
  server.registerTool(
    "sirius_stop",
    {
      title: "Stop the Session Timer",
      description:
        "Stop the running session and append it to the journal with the measured minutes (override with minutes). Replies with the actual / estimate ratio and today's total.",
      inputSchema: {
        outcome: z.enum(OUTCOMES).describe("done | partial | blocked | abandoned"),
        note: z.string().optional().describe("Short note in the learner's words"),
        minutes: z.number().int().min(1).optional().describe("Override the measured minutes (e.g. after forgetting to stop)"),
        hub: hubField,
        now: nowField,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) => safe(async () => text((await runStop(args)).text)),
  );

  /* 8. sirius_log */
  server.registerTool(
    "sirius_log",
    {
      title: "Log an Untimed Session",
      description:
        "Append a session the learner already did without the timer. With start_time the session starts at date + start_time; otherwise it ends now. Another date requires start_time (no guessing).",
      inputSchema: {
        subject: z.string().min(1).describe("Subject name, folder or alias"),
        minutes: z.number().int().min(1).describe("Minutes actually spent"),
        outcome: z.enum(OUTCOMES).describe("done | partial | blocked | abandoned"),
        kind: z.enum(SESSION_KINDS).optional().describe("learn (default) | practice | review | homework | project | meta"),
        task: z.string().optional().describe("Free text or a task id"),
        estimate_minutes: z.number().int().min(1).optional().describe("Original estimate, for the planning-accuracy ratio"),
        date: z.string().optional().describe("YYYY-MM-DD (default: today)"),
        start_time: z.string().optional().describe("HH:mm"),
        note: z.string().optional().describe("Short note in the learner's words"),
        commit_id: z.string().optional().describe("Commitment id from sirius_commit"),
        hub: hubField,
        now: nowField,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) => safe(async () => text((await runLog(args)).text)),
  );

  /* 9. sirius_week */
  server.registerTool(
    "sirius_week",
    {
      title: "Weekly Plan-vs-Actual Review",
      description:
        "Weekly review: study hours versus the budget in MASTER_ROADMAP.md, per-subject table with evidence from Vega, Orion, Aurora, Mira, Polaris, Rigel (grounded questions and cards from lesson materials) and git, plan per day versus actual, estimate accuracy, capacity-true budget, deadlines, study versus infrastructure time, Sunday ritual, and a shareable summary. Writes Roadmaps/weekly_reviews/<year>-W<week>.md only when write is true.",
      inputSchema: {
        hub: hubField,
        now: nowField,
        week: z.string().optional().describe("Any YYYY-MM-DD inside the week (default: the current week)"),
        write: z.boolean().optional().describe("Write the review to Roadmaps/weekly_reviews/<year>-W<week>.md (default false)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) => safe(async () => text((await runWeek(args)).text)),
  );

  /* 10. sirius_stats */
  server.registerTool(
    "sirius_stats",
    {
      title: "Study Statistics",
      description:
        "Read-only. Per ISO week study minutes by subject, meta minutes, study days, and (when Rigel left activity) the weekly count of grounded questions; streak tolerant to one missed day; study days in the last 14 days; capacity-true weekly hours; median actual / estimate ratio; commitment keep rate.",
      inputSchema: {
        hub: hubField,
        now: nowField,
        weeks: z.number().int().min(1).max(26).optional().describe("Number of weeks (default 4, max 26)"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => safe(async () => text((await runStats(args)).text)),
  );

  return server;
}

export async function startMcp(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

/* ───────── CLI Command Dispatcher ───────── */

interface ParsedArgs {
  pos: string[];
  flags: Map<string, string>;
  bools: Set<string>;
}

const VALUE_FLAGS = new Set([
  "hub",
  "now",
  "subject",
  "before",
  "where",
  "date",
  "kind",
  "commit",
  "minutes",
  "estimate",
  "start",
  "weeks",
]);
const BOOL_FLAGS = new Set(["json", "detail", "write"]);

function parseArgs(args: string[]): ParsedArgs {
  const out: ParsedArgs = { pos: [], flags: new Map(), bools: new Set() };
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("--") && a.length > 2) {
      const eq = a.indexOf("=");
      const name = (eq > 0 ? a.slice(2, eq) : a.slice(2)).toLowerCase();
      if (BOOL_FLAGS.has(name)) {
        out.bools.add(name);
        continue;
      }
      if (VALUE_FLAGS.has(name)) {
        const v = eq > 0 ? a.slice(eq + 1) : args[++i];
        if (v === undefined) throw new Error(`Thiếu giá trị cho --${name}.`);
        out.flags.set(name, v);
        continue;
      }
      throw new Error(`Cờ không hợp lệ: --${name}. Chạy 'sirius help' để xem danh sách.`);
    }
    out.pos.push(a);
  }
  return out;
}

function toInt(s: string | undefined, name: string): number {
  const n = Number(s);
  if (s === undefined || s.trim() === "" || !Number.isInteger(n)) throw new Error(`${name} phải là số nguyên (nhận "${s ?? ""}").`);
  return n;
}

const HELP = `Sirius MCP v${VERSION} - execution loop for the learning hub

Usage:
  sirius <command> [options]

Commands:
  deadlines [--detail] [--subject <s>]      Deadline sentinel: overdue, <24h, <48h, <72h, later
  today [YYYY-MM-DD]                        Today router (priorities, weekly template, reviews, commitments)
  triage suggest [--before YYYY-MM-DD]      Suggest decisions for untriaged overdue tasks (read-only)
  triage list                               Latest decision per task id (refreshes .sirius/triage.json)
  triage record <json-or-file>              Record decisions the learner confirmed
  commit <subject> <HH:mm> <minutes> <action...> [--where <w>] [--date YYYY-MM-DD]
  start <subject> <estimate_minutes> [task...] [--kind <k>] [--commit <id>]
  stop <done|partial|blocked|abandoned> [note...] [--minutes <n>]
  log <subject> <minutes> <outcome> [task...] [--kind <k>] [--estimate <n>] [--date d] [--start HH:mm]
  week [YYYY-MM-DD] [--write]               Weekly plan-vs-actual review (--write saves Roadmaps/weekly_reviews)
  stats [--weeks n]                         Weekly trends, streak, capacity, estimate ratio
  guide [topic]                             View the guide (topics: ${GUIDE_TOPICS.join(", ")})
  version                                   Print the version (${VERSION})
  help                                      Show this help message

Global options:
  --hub <path>   Hub folder (default: SIRIUS_HUB, POLARIS_HUB, then D:/02_Learning_Knowledge)
  --now <iso>    Override the clock (default: SIRIUS_NOW, then the system clock)
  --json         Output machine-readable JSON`;

export async function cli(argv: string[]): Promise<number> {
  try {
    const first = argv[0]?.toLowerCase() ?? "help";
    if (first === "version" || first === "-v" || first === "--version") {
      console.log(VERSION);
      return 0;
    }
    if (first === "help" || first === "-h" || first === "--help") {
      console.log(HELP);
      return 0;
    }
    const parsed = parseArgs(argv);
    const cmd = (parsed.pos[0] ?? "help").toLowerCase();
    const args = parsed.pos.slice(1);
    const isJson = parsed.bools.has("json");
    const common = { hub: parsed.flags.get("hub"), now: parsed.flags.get("now") };
    const emit = (res: OpResult) => {
      console.log(isJson ? JSON.stringify(res.data, null, 2) : res.text);
    };

    switch (cmd) {
      case "version":
        console.log(VERSION);
        return 0;
      case "help":
        console.log(HELP);
        return 0;

      case "guide": {
        const topic = args[0];
        const content = getGuideTopic(topic);
        console.log(isJson ? JSON.stringify({ topic: topic ?? "index", content }, null, 2) : content);
        return 0;
      }

      case "deadlines": {
        emit(
          await runDeadlines({
            ...common,
            detail: parsed.bools.has("detail"),
            subject: parsed.flags.get("subject"),
          }),
        );
        return 0;
      }

      case "today": {
        emit(await runToday({ ...common, date: args[0] ?? parsed.flags.get("date") }));
        return 0;
      }

      case "triage": {
        const action = (args[0] ?? "").toLowerCase();
        if (action !== "suggest" && action !== "list" && action !== "record") {
          console.error("Usage: sirius triage suggest [--before YYYY-MM-DD] | triage list | triage record <json-or-file>");
          return 1;
        }
        let decisions: unknown;
        if (action === "record") {
          const src = args.slice(1).join(" ").trim();
          if (!src) {
            console.error("Usage: sirius triage record <json-or-file>");
            return 1;
          }
          const raw = existsSync(src) ? readFileSync(src, "utf8").replace(/^\uFEFF/, "") : src;
          try {
            decisions = JSON.parse(raw);
          } catch (e) {
            throw new Error(`JSON không đọc được: ${errMsg(e)}`);
          }
        }
        emit(await runTriage({ action, ...common, before: parsed.flags.get("before"), decisions }));
        return 0;
      }

      case "commit": {
        const [subject, time, minutes, ...action] = args;
        if (!subject || !time || !minutes || action.length === 0) {
          console.error("Usage: sirius commit <subject> <HH:mm> <minutes> <action...> [--where <w>] [--date YYYY-MM-DD]");
          return 1;
        }
        emit(
          await runCommit({
            ...common,
            subject,
            time,
            minutes: toInt(minutes, "minutes"),
            action: action.join(" "),
            where: parsed.flags.get("where"),
            date: parsed.flags.get("date"),
          }),
        );
        return 0;
      }

      case "start": {
        const [subject, estimate, ...task] = args;
        if (!subject || !estimate) {
          console.error("Usage: sirius start <subject> <estimate_minutes> [task...] [--kind <k>] [--commit <id>]");
          return 1;
        }
        emit(
          await runStart({
            ...common,
            subject,
            estimate_minutes: toInt(estimate, "estimate_minutes"),
            task: task.length > 0 ? task.join(" ") : undefined,
            kind: parsed.flags.get("kind"),
            commit_id: parsed.flags.get("commit"),
          }),
        );
        return 0;
      }

      case "stop": {
        const [outcome, ...note] = args;
        if (!outcome) {
          console.error("Usage: sirius stop <done|partial|blocked|abandoned> [note...] [--minutes <n>]");
          return 1;
        }
        const minutes = parsed.flags.get("minutes");
        emit(
          await runStop({
            ...common,
            outcome,
            note: note.length > 0 ? note.join(" ") : undefined,
            minutes: minutes !== undefined ? toInt(minutes, "minutes") : undefined,
          }),
        );
        return 0;
      }

      case "log": {
        const [subject, minutes, outcome, ...task] = args;
        if (!subject || !minutes || !outcome) {
          console.error(
            "Usage: sirius log <subject> <minutes> <outcome> [task...] [--kind <k>] [--estimate <n>] [--date d] [--start HH:mm]",
          );
          return 1;
        }
        const estimate = parsed.flags.get("estimate");
        emit(
          await runLog({
            ...common,
            subject,
            minutes: toInt(minutes, "minutes"),
            outcome,
            task: task.length > 0 ? task.join(" ") : undefined,
            kind: parsed.flags.get("kind"),
            estimate_minutes: estimate !== undefined ? toInt(estimate, "estimate") : undefined,
            date: parsed.flags.get("date"),
            start_time: parsed.flags.get("start"),
          }),
        );
        return 0;
      }

      case "week": {
        emit(await runWeek({ ...common, week: args[0], write: parsed.bools.has("write") }));
        return 0;
      }

      case "stats": {
        const weeks = parsed.flags.get("weeks");
        emit(await runStats({ ...common, weeks: weeks !== undefined ? toInt(weeks, "weeks") : undefined }));
        return 0;
      }

      default: {
        console.error(`Unknown command: ${cmd}. Run 'sirius help' for usage.`);
        return 1;
      }
    }
  } catch (e) {
    console.error(errMsg(e));
    return 1;
  }
}

// Entrypoint
const isMain =
  Boolean(process.argv[1]) &&
  (resolve(process.argv[1]!) === fileURLToPath(import.meta.url) || basename(process.argv[1]!).startsWith("sirius"));

if (isMain) {
  const isCli = process.argv.length > 2 && !["mcp"].includes(process.argv[2]!);
  if (isCli) {
    cli(process.argv.slice(2))
      .then((code) => {
        if (code !== 0) process.exit(code);
      })
      .catch((err) => {
        console.error(errMsg(err));
        process.exit(1);
      });
  } else {
    startMcp().catch((err) => {
      console.error("Failed to start Sirius MCP server:", errMsg(err));
      process.exit(1);
    });
  }
}
