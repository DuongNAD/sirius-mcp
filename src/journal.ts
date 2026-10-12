import { existsSync } from "node:fs";
import { appendFile, mkdir, open, stat, unlink, writeFile } from "node:fs/promises";
import { loadCtx, resolveSubject, subjectName, type Ctx } from "./hub.js";
import {
  ActiveSessionSchema,
  JournalRecordSchema,
  OUTCOMES,
  SESSION_KINDS,
  formatZodIssues,
  parseJournalRecord,
  type ActiveSession,
  type CommitRecord,
  type JournalRecord,
  type OpResult,
  type Outcome,
  type SessionKind,
  type SessionRecord,
  type TriageRecord,
} from "./schema.js";
import {
  atomicWriteFile,
  isValidDateStr,
  isValidTimeStr,
  localDateStr,
  localIso,
  localTimeStr,
  normTime,
  parseLocal,
  randomHex,
  readText,
} from "./util.js";

/* ───────── Paths ───────── */

export const siriusDir = (hub: string): string => `${hub}/.sirius`;
export const journalPath = (hub: string): string => `${siriusDir(hub)}/journal.jsonl`;
export const activePath = (hub: string): string => `${siriusDir(hub)}/active.json`;
export const triageFilePath = (hub: string): string => `${siriusDir(hub)}/triage.json`;

/** Exact content of <hub>/.sirius/.gitignore (privacy: the learner's repo is public). */
export const SIRIUS_GITIGNORE = "# Created by Sirius: personal study data, never commit.\n*\n";

/**
 * Called before EVERY write into <hub>/.sirius/ (journal append, active.json, triage.json).
 * Makes sure the folder exists and that <hub>/.sirius/.gitignore exists (created when missing, never
 * overwritten), so the personal data stays out of git even when the hub's root .gitignore lacks .sirius/.
 */
export async function ensureSiriusDir(hub: string): Promise<void> {
  const dir = siriusDir(hub);
  await mkdir(dir, { recursive: true });
  try {
    await writeFile(`${dir}/.gitignore`, SIRIUS_GITIGNORE, { encoding: "utf8", flag: "wx" });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
  }
}

/* ───────── Journal ───────── */

export interface JournalData {
  records: JournalRecord[];
  sessions: SessionRecord[];
  commits: CommitRecord[];
  triage: TriageRecord[];
  /** Lines that were not valid JSON or did not match a record schema (skipped). */
  invalid: number;
}

export async function readJournal(hub: string): Promise<JournalData> {
  const data: JournalData = { records: [], sessions: [], commits: [], triage: [], invalid: 0 };
  const text = await readText(journalPath(hub));
  if (text === undefined) return data;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      data.invalid++;
      continue;
    }
    const rec = parseJournalRecord(obj);
    if (!rec) {
      data.invalid++;
      continue;
    }
    data.records.push(rec);
    if (rec.type === "session") data.sessions.push(rec);
    else if (rec.type === "commit") data.commits.push(rec);
    else data.triage.push(rec);
  }
  return data;
}

export async function appendRecord(hub: string, rec: JournalRecord): Promise<void> {
  const parsed = JournalRecordSchema.safeParse(rec);
  if (!parsed.success) {
    throw new Error(`Bản ghi journal không hợp lệ: ${formatZodIssues(parsed.error.issues).join("; ")}`);
  }
  await ensureSiriusDir(hub);
  const p = journalPath(hub);
  let prefix = "";
  try {
    const st = await stat(p);
    if (st.size > 0) {
      const fh = await open(p, "r");
      try {
        const b = Buffer.alloc(1);
        await fh.read(b, 0, 1, st.size - 1);
        if (b[0] !== 0x0a) prefix = "\n";
      } finally {
        await fh.close();
      }
    }
  } catch {
    // no journal yet
  }
  await appendFile(p, `${prefix}${JSON.stringify(parsed.data)}\n`, "utf8");
}

export function newId(prefix: "s" | "c", journal: JournalData): string {
  const used = new Set(journal.records.map((r) => ("id" in r ? r.id : "")));
  for (;;) {
    const id = `${prefix}_${randomHex(8)}`;
    if (!used.has(id)) return id;
  }
}

/* ───────── Running timer ───────── */

export async function readActive(hub: string): Promise<ActiveSession | undefined> {
  const p = activePath(hub);
  const text = await readText(p);
  if (text === undefined) return undefined;
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error(`active.json bị hỏng (${p}). Xóa tệp này rồi bắt đầu lại.`);
  }
  const res = ActiveSessionSchema.safeParse(obj);
  if (!res.success) {
    throw new Error(`active.json không hợp lệ (${p}): ${formatZodIssues(res.error.issues).join("; ")}`);
  }
  return res.data;
}

async function writeActive(hub: string, a: ActiveSession): Promise<void> {
  await ensureSiriusDir(hub);
  await atomicWriteFile(activePath(hub), JSON.stringify(a, null, 2) + "\n");
}

async function clearActive(hub: string): Promise<void> {
  try {
    await unlink(activePath(hub));
  } catch {
    // already gone
  }
}

/* ───────── Labels and aggregates ───────── */

export const KIND_LABEL: Record<SessionKind, string> = {
  learn: "học",
  practice: "luyện tập",
  review: "ôn tập",
  homework: "bài tập",
  project: "dự án",
  meta: "meta",
};

export const OUTCOME_LABEL: Record<Outcome, string> = {
  done: "hoàn thành",
  partial: "một phần",
  blocked: "bị chặn",
  abandoned: "bỏ dở",
};

export function parseKind(v: string | undefined, fallback: SessionKind = "learn"): SessionKind {
  if (v === undefined || v === "") return fallback;
  if ((SESSION_KINDS as readonly string[]).includes(v)) return v as SessionKind;
  throw new Error(`kind không hợp lệ: "${v}". Hợp lệ: ${SESSION_KINDS.join(", ")}.`);
}

export function parseOutcome(v: string | undefined): Outcome {
  if (v && (OUTCOMES as readonly string[]).includes(v)) return v as Outcome;
  throw new Error(`outcome không hợp lệ: "${v ?? ""}". Hợp lệ: ${OUTCOMES.join(", ")}.`);
}

/** Local date of the session start. */
export function sessionDate(s: SessionRecord): string {
  return localDateStr(new Date(s.start));
}

export interface DayTotals {
  study: number;
  meta: number;
  count: number;
  bySubject: Record<string, number>;
  byKind: Record<string, number>;
}

export function dayTotals(sessions: SessionRecord[], date: string): DayTotals {
  const t: DayTotals = { study: 0, meta: 0, count: 0, bySubject: {}, byKind: {} };
  for (const s of sessions) {
    if (sessionDate(s) !== date) continue;
    t.count++;
    if (s.kind === "meta") t.meta += s.minutes;
    else t.study += s.minutes;
    t.bySubject[s.subject] = (t.bySubject[s.subject] ?? 0) + s.minutes;
    t.byKind[s.kind] = (t.byKind[s.kind] ?? 0) + s.minutes;
  }
  return t;
}

/** Daily minimum of study minutes (non-meta); SIRIUS_DAILY_MIN overrides the default 25. */
export function dailyMinimum(): number {
  const n = Number(process.env.SIRIUS_DAILY_MIN);
  return Number.isInteger(n) && n > 0 ? n : 25;
}

/* ───────── Commitment status ───────── */

export type CommitStatusCode = "kept" | "late" | "missed" | "pending";

export const COMMIT_STATUS_LABEL: Record<CommitStatusCode, string> = {
  kept: "đúng hẹn",
  late: "trễ",
  missed: "bỏ lỡ",
  pending: "chưa tới giờ",
};

/**
 * kept: a session of the same subject starts within [time - 30 min, time + 90 min] on that date;
 * late: a session linked to the commit (outside the window) or a later session of that subject that day;
 * missed: nothing happened and the day is over; pending otherwise.
 */
export function commitStatus(c: CommitRecord, sessions: SessionRecord[], now: Date): CommitStatusCode {
  const at = parseLocal(c.date, c.time).getTime();
  const winStart = at - 30 * 60000;
  const winEnd = at + 90 * 60000;
  const mine = sessions.filter(
    (s) => s.subject === c.subject && (s.commitId === c.id || sessionDate(s) === c.date),
  );
  const starts = mine.map((s) => Date.parse(s.start));
  if (starts.some((t) => t >= winStart && t <= winEnd)) return "kept";
  if (mine.some((s) => s.commitId === c.id)) return "late";
  if (starts.some((t) => t > winEnd)) return "late";
  return localDateStr(now) > c.date ? "missed" : "pending";
}

/* ───────── Operations: commit, start, stop, log ───────── */

function requireMinutes(v: number | undefined, name: string, min: number): number {
  if (v === undefined || !Number.isFinite(v) || !Number.isInteger(v) || v < min) {
    throw new Error(`${name} phải là số nguyên từ ${min} trở lên.`);
  }
  return v;
}

export async function runCommit(a: {
  hub?: string;
  now?: string;
  subject: string;
  time: string;
  action: string;
  minutes: number;
  where?: string;
  date?: string;
}): Promise<OpResult> {
  const ctx = await loadCtx(a);
  const subject = resolveSubject(ctx.model.subjects, a.subject);
  if (!isValidTimeStr(a.time)) throw new Error(`time không hợp lệ: "${a.time}" (cần HH:mm, ví dụ 08:30).`);
  const date = a.date?.trim() || ctx.today;
  if (!isValidDateStr(date)) throw new Error(`date không hợp lệ: "${date}" (cần YYYY-MM-DD).`);
  const minutes = requireMinutes(a.minutes, "minutes", 5);
  const action = (a.action ?? "").trim();
  if (!action) throw new Error("action không được để trống: ghi bước đầu tiên cụ thể bạn sẽ làm.");
  const where = a.where?.trim() || undefined;

  const journal = await readJournal(ctx.hub);
  const id = newId("c", journal);
  const rec: CommitRecord = {
    v: 1,
    type: "commit",
    at: localIso(ctx.now),
    id,
    date,
    time: normTime(a.time),
    subject: subject.key,
    action,
    ...(where ? { where } : {}),
    minutes,
  };
  await appendRecord(ctx.hub, rec);

  const sentence = `Khi ${rec.time}${date !== ctx.today ? ` ngày ${date}` : ""}${where ? ` ở ${where}` : ""}, mình sẽ ${action} trong ${minutes} phút.`;
  const text = [
    `Đã ghi cam kết ${id} (${subject.name}):`,
    sentence,
    `Khi bắt đầu, gọi sirius_start { subject: "${subject.name}", estimate_minutes: ${minutes}, commit_id: "${id}" }.`,
  ].join("\n");
  return { text, data: { commit: rec, sentence } };
}

function elapsedMinutes(startIso: string, now: Date): number {
  return Math.round((now.getTime() - Date.parse(startIso)) / 60000);
}

export async function runStart(a: {
  hub?: string;
  now?: string;
  subject: string;
  estimate_minutes: number;
  task?: string;
  kind?: string;
  commit_id?: string;
}): Promise<OpResult> {
  const ctx = await loadCtx(a);
  const subject = resolveSubject(ctx.model.subjects, a.subject);
  const estimate = requireMinutes(a.estimate_minutes, "estimate_minutes", 1);
  const kind = parseKind(a.kind);

  const active = await readActive(ctx.hub);
  if (active) {
    throw new Error(
      `Đang có phiên chạy ${active.id}: ${subjectName(ctx.model, active.subject)}${active.task ? ` (${active.task})` : ""}, bắt đầu ${localTimeStr(new Date(active.start))} ngày ${localDateStr(new Date(active.start))} (đã ${Math.max(0, elapsedMinutes(active.start, ctx.now))} phút, ước lượng ${active.estimate} phút). Gọi sirius_stop để đóng phiên này trước khi bắt đầu phiên mới.`,
    );
  }

  const journal = await readJournal(ctx.hub);
  const commitId = a.commit_id?.trim() || undefined;
  if (commitId) {
    const c = journal.commits.find((x) => x.id === commitId);
    if (!c) throw new Error(`Không tìm thấy cam kết "${commitId}" trong journal. Tạo bằng sirius_commit trước.`);
    if (c.subject !== subject.key) {
      throw new Error(`Cam kết ${commitId} thuộc khóa ${subjectName(ctx.model, c.subject)}, không khớp khóa ${subject.name}.`);
    }
  }

  const rec: ActiveSession = {
    v: 1,
    id: newId("s", journal),
    subject: subject.key,
    kind,
    ...(a.task?.trim() ? { task: a.task.trim() } : {}),
    start: localIso(ctx.now),
    estimate,
    ...(commitId ? { commitId } : {}),
  };
  await writeActive(ctx.hub, rec);

  const text = [
    `Đã bắt đầu phiên ${rec.id} lúc ${localTimeStr(ctx.now)}: ${subject.name}${rec.task ? ` - ${rec.task}` : ""} (${KIND_LABEL[kind]}, ước lượng ${estimate} phút).`,
    `Khi xong, gọi sirius_stop { outcome: "done" | "partial" | "blocked" | "abandoned" } để ghi nhận thời gian thực tế.`,
  ].join("\n");
  return { text, data: { active: rec } };
}

function sessionReply(
  ctx: Ctx,
  rec: SessionRecord,
  prior: SessionRecord[],
  warnings: string[],
): OpResult {
  const name = subjectName(ctx.model, rec.subject);
  const lines: string[] = [
    `Đã ghi phiên ${rec.id}: ${name}, ${rec.minutes} phút (${KIND_LABEL[rec.kind]}, ${OUTCOME_LABEL[rec.outcome]}).`,
  ];
  let ratio: number | undefined;
  if (rec.estimate) {
    ratio = rec.minutes / rec.estimate;
    lines.push(`Đối chiếu: thực tế / ước lượng = ${ratio.toFixed(1)} (${rec.minutes} phút / ${rec.estimate} phút).`);
  }
  const totals = dayTotals([...prior, rec], localDateStr(new Date(rec.start)));
  lines.push(`Hôm nay: ${totals.study} phút học, ${totals.meta} phút meta, ${totals.count} phiên.`);
  for (const w of warnings) lines.push(`Cảnh báo: ${w}`);
  return { text: lines.join("\n"), data: { session: rec, ratio, today: totals, warnings } };
}

export async function runStop(a: {
  hub?: string;
  now?: string;
  outcome: string;
  note?: string;
  minutes?: number;
}): Promise<OpResult> {
  const ctx = await loadCtx(a);
  const outcome = parseOutcome(a.outcome);
  const active = await readActive(ctx.hub);
  if (!active) {
    throw new Error(
      "Không có phiên nào đang chạy. Dùng sirius_start trước, hoặc sirius_log để ghi một phiên đã học mà không bấm giờ.",
    );
  }
  const startMs = Date.parse(active.start);
  if (ctx.now.getTime() < startMs - 60000) {
    throw new Error(`Thời điểm dừng (${localIso(ctx.now)}) sớm hơn lúc bắt đầu (${active.start}).`);
  }
  const warnings: string[] = [];
  const computed = Math.max(1, Math.round((ctx.now.getTime() - startMs) / 60000));
  let minutes = computed;
  if (a.minutes !== undefined) {
    minutes = requireMinutes(a.minutes, "minutes", 1);
  } else if (computed > 240) {
    warnings.push("phiên dài bất thường, quên dừng? Có thể ghi đè bằng tham số minutes.");
  }

  const journal = await readJournal(ctx.hub);
  const rec: SessionRecord = {
    v: 1,
    type: "session",
    at: localIso(ctx.now),
    id: active.id,
    subject: active.subject,
    kind: active.kind,
    ...(active.task ? { task: active.task } : {}),
    start: active.start,
    end: localIso(ctx.now),
    minutes,
    estimate: active.estimate,
    outcome,
    ...(a.note?.trim() ? { note: a.note.trim() } : {}),
    ...(active.commitId ? { commitId: active.commitId } : {}),
    source: "timer",
  };
  await appendRecord(ctx.hub, rec);
  await clearActive(ctx.hub);
  return sessionReply(ctx, rec, journal.sessions, warnings);
}

export async function runLog(a: {
  hub?: string;
  now?: string;
  subject: string;
  minutes: number;
  outcome: string;
  kind?: string;
  task?: string;
  estimate_minutes?: number;
  date?: string;
  start_time?: string;
  note?: string;
  commit_id?: string;
}): Promise<OpResult> {
  const ctx = await loadCtx(a);
  const subject = resolveSubject(ctx.model.subjects, a.subject);
  const minutes = requireMinutes(a.minutes, "minutes", 1);
  if (minutes > 24 * 60) throw new Error("minutes không được quá 1440 (24 giờ).");
  const outcome = parseOutcome(a.outcome);
  const kind = parseKind(a.kind);
  const estimate = a.estimate_minutes !== undefined ? requireMinutes(a.estimate_minutes, "estimate_minutes", 1) : undefined;
  const date = a.date?.trim() || undefined;
  if (date && !isValidDateStr(date)) throw new Error(`date không hợp lệ: "${date}" (cần YYYY-MM-DD).`);
  const startTime = a.start_time?.trim() || undefined;
  if (startTime && !isValidTimeStr(startTime)) throw new Error(`start_time không hợp lệ: "${startTime}" (cần HH:mm).`);

  let start: Date;
  let end: Date;
  if (startTime) {
    start = parseLocal(date ?? ctx.today, normTime(startTime));
    end = new Date(start.getTime() + minutes * 60000);
  } else {
    if (date && date !== ctx.today) {
      throw new Error("Cần start_time (HH:mm) khi ghi phiên cho ngày khác hôm nay: Sirius không tự đoán giờ.");
    }
    end = ctx.now;
    start = new Date(end.getTime() - minutes * 60000);
  }
  if (end.getTime() > ctx.now.getTime() + 5 * 60000) {
    throw new Error(`Phiên kết thúc lúc ${localIso(end)}, sau thời điểm hiện tại (${localIso(ctx.now)}). Chỉ ghi việc đã làm.`);
  }

  const journal = await readJournal(ctx.hub);
  const commitId = a.commit_id?.trim() || undefined;
  if (commitId && !journal.commits.some((c) => c.id === commitId)) {
    throw new Error(`Không tìm thấy cam kết "${commitId}" trong journal.`);
  }
  const rec: SessionRecord = {
    v: 1,
    type: "session",
    at: localIso(ctx.now),
    id: newId("s", journal),
    subject: subject.key,
    kind,
    ...(a.task?.trim() ? { task: a.task.trim() } : {}),
    start: localIso(start),
    end: localIso(end),
    minutes,
    ...(estimate !== undefined ? { estimate } : {}),
    outcome,
    ...(a.note?.trim() ? { note: a.note.trim() } : {}),
    ...(commitId ? { commitId } : {}),
    source: "log",
  };
  await appendRecord(ctx.hub, rec);
  const warnings: string[] = [];
  if (subject.key === "hub" && kind !== "meta") {
    warnings.push('khóa hub thường là việc meta (làm công cụ, lập kế hoạch); nếu đúng, ghi kind: "meta".');
  }
  return sessionReply(ctx, rec, journal.sessions, warnings);
}
