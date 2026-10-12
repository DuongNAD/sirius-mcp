import { z } from "zod";
import { closest } from "./util.js";

export const SESSION_KINDS = ["learn", "practice", "review", "homework", "project", "meta"] as const;
export type SessionKind = (typeof SESSION_KINDS)[number];

export const OUTCOMES = ["done", "partial", "blocked", "abandoned"] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const TRIAGE_DECISIONS = ["superseded", "parked", "snoozed", "active"] as const;
export type TriageDecision = (typeof TRIAGE_DECISIONS)[number];

export const SESSION_SOURCES = ["timer", "log"] as const;

export const PRIORITIES = ["P0", "P1", "P2"] as const;
export type Priority = (typeof PRIORITIES)[number];

const isoStr = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "ISO 8601 timestamp expected");
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD expected");
const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:mm expected");

/* ───────── Journal records (<hub>/.sirius/journal.jsonl) ───────── */

export const SessionRecordSchema = z.object({
  v: z.literal(1),
  type: z.literal("session"),
  at: isoStr,
  id: z.string().regex(/^s_[0-9a-f]{8}$/),
  subject: z.string().min(1),
  kind: z.enum(SESSION_KINDS),
  task: z.string().optional(),
  start: isoStr,
  end: isoStr,
  minutes: z.number().int().min(1),
  estimate: z.number().int().min(1).optional(),
  outcome: z.enum(OUTCOMES),
  note: z.string().optional(),
  commitId: z.string().optional(),
  source: z.enum(SESSION_SOURCES),
});
export type SessionRecord = z.output<typeof SessionRecordSchema>;

export const CommitRecordSchema = z.object({
  v: z.literal(1),
  type: z.literal("commit"),
  at: isoStr,
  id: z.string().regex(/^c_[0-9a-f]{8}$/),
  date: dateStr,
  time: timeStr,
  subject: z.string().min(1),
  action: z.string().min(1),
  where: z.string().optional(),
  minutes: z.number().int().min(5),
});
export type CommitRecord = z.output<typeof CommitRecordSchema>;

export const TriageRecordSchema = z
  .object({
    v: z.literal(1),
    type: z.literal("triage"),
    at: isoStr,
    taskId: z.string().min(1),
    decision: z.enum(TRIAGE_DECISIONS),
    until: dateStr.optional(),
    replacedBy: z.string().optional(),
    note: z.string().optional(),
    file: z.string().min(1),
    line: z.number().int().min(0),
    text: z.string(),
    /** The full original task line at decision time (interop with pick_today.py). */
    raw: z.string().optional(),
    /** The exact text between "[Deadline:" and "]" at decision time. */
    deadlineRaw: z.string().optional(),
  })
  .refine((r) => r.decision !== "snoozed" || Boolean(r.until), {
    message: "until is required for snoozed decisions",
    path: ["until"],
  });
export type TriageRecord = z.output<typeof TriageRecordSchema>;

export const JournalRecordSchema = z.discriminatedUnion("type", [
  SessionRecordSchema,
  CommitRecordSchema,
  TriageRecordSchema,
]);
export type JournalRecord = z.output<typeof JournalRecordSchema>;

/* ───────── Running timer (<hub>/.sirius/active.json) ───────── */

export const ActiveSessionSchema = z.object({
  v: z.literal(1),
  id: z.string().regex(/^s_[0-9a-f]{8}$/),
  subject: z.string().min(1),
  kind: z.enum(SESSION_KINDS),
  task: z.string().optional(),
  start: isoStr,
  estimate: z.number().int().min(1),
  commitId: z.string().optional(),
});
export type ActiveSession = z.output<typeof ActiveSessionSchema>;

/* ───────── Tool inputs shared by MCP and CLI ───────── */

export const TriageDecisionInputSchema = z.strictObject({
  id: z.string().min(1).describe("Task id exactly as shown by sirius_deadlines or sirius_triage suggest"),
  decision: z.enum(TRIAGE_DECISIONS).describe("superseded | parked | snoozed | active"),
  until: dateStr.optional().describe("YYYY-MM-DD; required for snoozed and must be today or later"),
  replacedBy: z.string().optional().describe("Task id of the replacement (for superseded)"),
  note: z.string().optional().describe("Short reason in the learner's words"),
});
export type TriageDecisionInput = z.output<typeof TriageDecisionInputSchema>;

/** Result of a tool or CLI operation: Vietnamese text for the learner plus structured data for --json. */
export interface OpResult {
  text: string;
  data: unknown;
}

/* ───────── Error formatting ───────── */

export function formatZodIssues(issues: z.ZodIssue[], allowedKeys?: string[]): string[] {
  return issues.slice(0, 25).map((issue) => {
    let where = "";
    for (const seg of issue.path) {
      if (typeof seg === "number") where += `[${seg}]`;
      else where += where ? `.${String(seg)}` : String(seg);
    }
    let msg = issue.message;
    const anyIssue = issue as unknown as Record<string, unknown>;
    if (issue.code === "unrecognized_keys" && allowedKeys) {
      const keys = (anyIssue.keys as string[] | undefined) ?? [];
      const hints = keys
        .map((k) => [k, closest(k, allowedKeys)] as const)
        .filter(([, s]) => Boolean(s));
      if (hints.length) msg += ` (có phải ${hints.map(([k, s]) => `"${s}" thay cho "${k}"`).join(", ")}?)`;
      msg += ` - khóa cho phép: ${allowedKeys.join(", ")}`;
    }
    return `${where || "(root)"}: ${msg}`;
  });
}

/** Parse one journal line (already JSON-decoded). Returns undefined when the record is invalid. */
export function parseJournalRecord(obj: unknown): JournalRecord | undefined {
  const res = JournalRecordSchema.safeParse(obj);
  return res.success ? res.data : undefined;
}
