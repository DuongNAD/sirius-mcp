import {
  findSubject,
  loadCtx,
  resolveSubject,
  subjectName,
  taskIds,
  type Ctx,
  type Deviation,
  type HubModel,
  type TaskItem,
} from "./hub.js";
import { readJournal, type JournalData } from "./journal.js";
import type { OpResult, Priority, TriageRecord } from "./schema.js";
import {
  contentTokens,
  formatCountdown,
  hash,
  jaccard,
  localDateStr,
  localIso,
  localTimeStr,
  numberTokens,
  parseLocal,
  plainText,
  fmtVi,
  sameSet,
  truncate,
  viWeekday,
} from "./util.js";

export const BUCKETS = ["overdue", "urgent", "h48", "h72", "later"] as const;
export type BucketName = (typeof BUCKETS)[number];

export interface DeadlineItem {
  kind: "task" | "project" | "goal";
  id: string;
  subject: string;
  priority: Priority | null;
  /** "YYYY-MM-DD HH:mm" */
  deadline: string;
  deadlineMs: number;
  remainingMs: number;
  countdown: string;
  text: string;
  file: string;
  line: number;
  section?: string;
  board?: string;
  /** "file:line" of other places that list the same deadline (merged copies, ACTIVE_LEARNING blocks). */
  alsoIn?: string[];
  triage?: { decision: string; until?: string; at: string };
}

export interface BoardInfo {
  path: string;
  kind: string;
  subject: string;
  exists: boolean;
  tasks: number;
}

export interface ConflictSide {
  id: string;
  file: string;
  line: number;
  checked: boolean;
  deadline: string;
  text: string;
}

export interface DeadlineConflict {
  subject: string;
  jaccard: number;
  a: ConflictSide;
  b: ConflictSide;
}

export interface DeadlineResult {
  /** ISO 8601 with the local offset. */
  now: string;
  /** "YYYY-MM-DD HH:mm" as shown in the report header. */
  nowText: string;
  today: string;
  weekday: string;
  subject?: string;
  buckets: Record<BucketName, DeadlineItem[]>;
  triaged: number;
  triagedItems: DeadlineItem[];
  deviations: Deviation[];
  conflicts: DeadlineConflict[];
  boards: BoardInfo[];
  warnings: string[];
  invalidJournalLines: number;
  merged: number;
}

const PRIORITY_RANK: Record<string, number> = { P0: 0, P1: 1, P2: 2 };
const prank = (p: Priority | null): number => (p ? (PRIORITY_RANK[p] ?? 3) : 3);

/* ───────── Triage decisions (shared with triage.ts) ───────── */

/** Latest decision per task id (later `at` wins; equal `at` -> later line wins). */
export function latestById(triage: TriageRecord[]): Map<string, TriageRecord> {
  const m = new Map<string, TriageRecord>();
  for (const r of triage) {
    const cur = m.get(r.taskId);
    if (!cur || Date.parse(r.at) >= Date.parse(cur.at)) m.set(r.taskId, r);
  }
  return m;
}

/** Latest decision that applies to a merged task item (its own id or any copy's id). */
export function decisionFor(task: TaskItem, latest: Map<string, TriageRecord>): TriageRecord | undefined {
  let best: TriageRecord | undefined;
  for (const id of taskIds(task)) {
    const r = latest.get(id);
    if (r && (!best || Date.parse(r.at) >= Date.parse(best.at))) best = r;
  }
  return best;
}

/** superseded/parked exclude; snoozed excludes while until >= today; active never excludes. */
export function excludesTask(rec: TriageRecord, today: string): boolean {
  if (rec.decision === "superseded" || rec.decision === "parked") return true;
  if (rec.decision === "snoozed") return Boolean(rec.until) && (rec.until as string) >= today;
  return false;
}

/* ───────── Item building ───────── */

function deadlineMs(norm: string): number {
  return parseLocal(norm.slice(0, 10), norm.slice(11)).getTime();
}

function fromTask(t: TaskItem, nowMs: number): DeadlineItem {
  const ms = deadlineMs(t.deadline as string);
  return {
    kind: "task",
    id: t.id,
    subject: t.subject,
    priority: t.priority,
    deadline: t.deadline as string,
    deadlineMs: ms,
    remainingMs: ms - nowMs,
    countdown: formatCountdown(ms - nowMs),
    text: t.text,
    file: t.file,
    line: t.line,
    section: t.section,
    board: t.board,
    ...(t.alsoIn.length ? { alsoIn: [...t.alsoIn] } : {}),
  };
}

function addAlso(item: DeadlineItem, ref: string): void {
  if (!item.alsoIn) item.alsoIn = [];
  if (!item.alsoIn.includes(ref)) item.alsoIn.push(ref);
}

export function buildItems(ctx: Ctx, journal: JournalData): { items: DeadlineItem[]; triagedItems: DeadlineItem[] } {
  const nowMs = ctx.now.getTime();
  const model = ctx.model;
  const taskItems: DeadlineItem[] = [];
  const keeperById = new Map<string, TaskItem>();
  for (const t of model.tasks) {
    if (t.checked || !t.deadline) continue;
    taskItems.push(fromTask(t, nowMs));
    keeperById.set(t.id, t);
  }
  const items: DeadlineItem[] = [...taskItems];

  // Active Projects with a Deadline (dedupe against a task with the same subject and deadline minute).
  const projectItems: DeadlineItem[] = [];
  for (const s of model.subjects) {
    if (!s.deadline) continue;
    const dup = taskItems.find((x) => x.subject === s.key && x.deadline === s.deadline);
    if (dup) {
      addAlso(dup, `ACTIVE_LEARNING.md:${s.deadlineLine ?? 0}`);
      continue;
    }
    const ms = deadlineMs(s.deadline);
    projectItems.push({
      kind: "project",
      id: hash(`project|${s.key}|${s.deadline}`, 10),
      subject: s.key,
      priority: s.priority ?? null,
      deadline: s.deadline,
      deadlineMs: ms,
      remainingMs: ms - nowMs,
      countdown: formatCountdown(ms - nowMs),
      text: s.nextAction ?? s.name,
      file: "ACTIVE_LEARNING.md",
      line: s.deadlineLine ?? 0,
    });
  }
  items.push(...projectItems);

  // Today's Dynamic Goal (not Completed, with a Deadline).
  const g = model.goal;
  if (g && g.deadline && !/^completed$/i.test((g.status ?? "").trim())) {
    const subj = g.subject ? findSubject(model.subjects, g.subject) : undefined;
    const subjectKey = subj ? subj.key : "hub";
    if (g.subject && !subj) {
      const msg = `Today's Dynamic Goal: không nhận ra khóa "${g.subject}".`;
      if (!model.warnings.includes(msg)) model.warnings.push(msg);
    }
    const ref = `ACTIVE_LEARNING.md:${g.deadlineLine ?? g.line}`;
    const dup =
      taskItems.find((x) => x.subject === subjectKey && x.deadline === g.deadline) ??
      projectItems.find((x) => x.subject === subjectKey && x.deadline === g.deadline);
    if (dup) {
      addAlso(dup, ref);
    } else {
      const ms = deadlineMs(g.deadline);
      items.push({
        kind: "goal",
        id: hash(`goal|${subjectKey}|${g.deadline}`, 10),
        subject: subjectKey,
        priority: g.priority ?? null,
        deadline: g.deadline,
        deadlineMs: ms,
        remainingMs: ms - nowMs,
        countdown: formatCountdown(ms - nowMs),
        text: g.target ?? g.subject ?? "Mục tiêu hôm nay",
        file: "ACTIVE_LEARNING.md",
        line: g.deadlineLine ?? g.line,
      });
    }
  }

  // Triage filter (decisions apply to task items only).
  const latest = latestById(journal.triage);
  const kept: DeadlineItem[] = [];
  const triagedItems: DeadlineItem[] = [];
  for (const it of items) {
    if (it.kind === "task") {
      const t = keeperById.get(it.id);
      const rec = t ? decisionFor(t, latest) : undefined;
      if (rec && excludesTask(rec, ctx.today)) {
        triagedItems.push({
          ...it,
          triage: { decision: rec.decision, ...(rec.until ? { until: rec.until } : {}), at: rec.at },
        });
        continue;
      }
    }
    kept.push(it);
  }
  return { items: kept, triagedItems };
}

export function sortItems(items: DeadlineItem[]): DeadlineItem[] {
  return [...items].sort(
    (a, b) =>
      a.deadlineMs - b.deadlineMs ||
      prank(a.priority) - prank(b.priority) ||
      a.file.localeCompare(b.file) ||
      a.line - b.line,
  );
}

export function bucketOf(remainingMs: number): BucketName {
  const H = 3600000;
  if (remainingMs < 0) return "overdue";
  if (remainingMs <= 24 * H) return "urgent";
  if (remainingMs <= 48 * H) return "h48";
  if (remainingMs <= 72 * H) return "h72";
  return "later";
}

/* ───────── Conflicting deadlines (same event, different deadline) ───────── */

export function computeConflicts(model: HubModel, subjectKey?: string): DeadlineConflict[] {
  const bySubject = new Map<string, TaskItem[]>();
  for (const t of model.tasks) {
    if (!t.deadline) continue;
    if (subjectKey && t.subject !== subjectKey) continue;
    const list = bySubject.get(t.subject) ?? [];
    list.push(t);
    bySubject.set(t.subject, list);
  }
  const out: DeadlineConflict[] = [];
  const side = (t: TaskItem): ConflictSide => ({
    id: t.id,
    file: t.file,
    line: t.line,
    checked: t.checked,
    deadline: t.deadline as string,
    text: t.text,
  });
  for (const [subject, list] of bySubject) {
    const tokens = list.map((t) => contentTokens(t.text));
    const nums = list.map((t) => numberTokens(t.text));
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!;
        const b = list[j]!;
        if (a.deadline === b.deadline) continue;
        const na = nums[i]!;
        const nb = nums[j]!;
        if (na.size > 0 && nb.size > 0 && !sameSet(na, nb)) continue;
        const score = jaccard(tokens[i]!, tokens[j]!);
        if (score < 0.6) continue;
        out.push({ subject, jaccard: Math.round(score * 100) / 100, a: side(a), b: side(b) });
      }
    }
  }
  out.sort((x, y) => y.jaccard - x.jaccard || x.a.file.localeCompare(y.a.file) || x.a.line - y.a.line);
  return out;
}

/* ───────── Compute ───────── */

export function computeDeadlines(ctx: Ctx, journal: JournalData, subjectKey?: string): DeadlineResult {
  const { items, triagedItems } = buildItems(ctx, journal);
  const sel = (it: DeadlineItem) => !subjectKey || it.subject === subjectKey;
  const buckets: Record<BucketName, DeadlineItem[]> = { overdue: [], urgent: [], h48: [], h72: [], later: [] };
  for (const it of sortItems(items.filter(sel))) buckets[bucketOf(it.remainingMs)].push(it);
  const triaged = sortItems(triagedItems.filter(sel));
  const warnings = [...ctx.model.warnings];
  if (journal.invalid > 0) warnings.push(`${journal.invalid} dòng journal không hợp lệ đã bị bỏ qua.`);
  return {
    now: localIso(ctx.now),
    nowText: `${localDateStr(ctx.now)} ${localTimeStr(ctx.now)}`,
    today: ctx.today,
    weekday: viWeekday(ctx.today),
    ...(subjectKey ? { subject: subjectKey } : {}),
    buckets,
    triaged: triaged.length,
    triagedItems: triaged,
    deviations: ctx.model.deviations.filter((d) => !subjectKey || d.subject === subjectKey),
    conflicts: computeConflicts(ctx.model, subjectKey),
    boards: ctx.model.boards.map((b) => ({
      path: b.rel,
      kind: b.kind,
      subject: b.subject,
      exists: b.exists,
      tasks: b.taskCount,
    })),
    warnings,
    invalidJournalLines: journal.invalid,
    merged: ctx.model.mergedCount,
  };
}

/* ───────── Rendering ───────── */

function labelOf(it: DeadlineItem): string {
  const base = plainText(it.text);
  const prefix = it.kind === "project" ? "Dự án: " : it.kind === "goal" ? "Mục tiêu hôm nay: " : "";
  return truncate(prefix + base, 110);
}

export function renderRow(it: DeadlineItem, mode: "overdue" | "upcoming" | "triaged"): string {
  const pr = it.priority ?? "P?";
  const where = `${it.file}:${it.line}`;
  const also = it.alsoIn && it.alsoIn.length ? ` (cũng có ở ${it.alsoIn.join(", ")})` : "";
  const head = `- [${pr}] ${labelOf(it)} (${where})${also}`;
  if (mode === "overdue") return `${head}, ${it.countdown}, id ${it.id}`;
  if (mode === "upcoming") return `${head}, hạn ${it.deadline}, ${it.countdown}`;
  const t = it.triage;
  const dec = t ? `${t.decision}${t.until ? ` đến ${t.until}` : ""}` : "đã phân loại";
  return `${head}, hạn ${it.deadline}, ${dec}, id ${it.id}`;
}

function conflictRow(c: DeadlineConflict, model: HubModel): string {
  const mark = (s: ConflictSide) => `${s.file}:${s.line} (hạn ${s.deadline}${s.checked ? ", đã tick" : ""})`;
  return `- ${subjectName(model, c.subject)}: ${mark(c.a)} và ${mark(c.b)}: "${truncate(plainText(c.a.text), 80)}" (độ giống ${fmtVi(c.jaccard, 2)})`;
}

export function renderDeadlines(res: DeadlineResult, model: HubModel, opts: { detail?: boolean } = {}): string {
  const detail = Boolean(opts.detail);
  const L: string[] = [];
  L.push(`# Kiểm tra hạn chót (${res.nowText}, ${res.weekday})`);
  if (res.subject) L.push(`Bộ lọc khóa: ${subjectName(model, res.subject)}`);
  L.push("");

  // Overdue
  const od = res.buckets.overdue;
  L.push(od.length > 0 ? `## Quá hạn: ${od.length} mục (cảnh báo trước mọi việc khác)` : `## Quá hạn: 0 mục`);
  if (od.length > 0) {
    const perBoard = new Map<string, number>();
    for (const it of od) perBoard.set(it.file, (perBoard.get(it.file) ?? 0) + 1);
    for (const [file, n] of [...perBoard.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
      L.push(`- ${file}: ${n}`);
    }
    L.push("");
    const mostRecentFirst = [...od].sort((a, b) => b.deadlineMs - a.deadlineMs || prank(a.priority) - prank(b.priority));
    const shown = detail ? mostRecentFirst : mostRecentFirst.slice(0, 10);
    for (const it of shown) L.push(renderRow(it, "overdue"));
    if (!detail && od.length > shown.length) {
      L.push(`... còn ${od.length - shown.length} mục quá hạn nữa (dùng detail: true để xem đủ).`);
    }
    L.push("");
    L.push('Gợi ý: chạy sirius_triage { action: "suggest" } để tách việc đã bị thay thế khỏi việc thật sự trễ.');
  }
  L.push("");

  // Urgent
  const ug = res.buckets.urgent;
  L.push(`## Khẩn cấp, dưới 24 giờ: ${ug.length} mục`);
  for (const it of ug) L.push(renderRow(it, "upcoming"));
  if (ug.length > 0) {
    L.push("");
    L.push("### Kế hoạch tập trung");
    ug.forEach((it, i) => {
      L.push(`${i + 1}. ${truncate(plainText(it.text), 70)}: làm ngay hôm nay, chặn lịch trước hạn; tạm dừng việc P2 khác`);
    });
  }
  L.push("");

  const h48 = res.buckets.h48;
  L.push(`## Dưới 48 giờ: ${h48.length} mục`);
  for (const it of h48) L.push(renderRow(it, "upcoming"));
  if (h48.length > 0) L.push("Dồn buổi học hôm nay vào việc này.");
  L.push("");

  const h72 = res.buckets.h72;
  L.push(`## Dưới 72 giờ: ${h72.length} mục`);
  for (const it of h72) L.push(renderRow(it, "upcoming"));
  if (h72.length > 0) L.push("Nên chặn sẵn thời gian.");
  L.push("");

  const later = res.buckets.later;
  L.push(
    detail || later.length === 0
      ? `## Theo dõi (trên 72 giờ): ${later.length} mục`
      : `## Theo dõi (trên 72 giờ): ${later.length} mục; ${Math.min(5, later.length)} hạn gần nhất:`,
  );
  for (const it of detail ? later : later.slice(0, 5)) L.push(renderRow(it, "upcoming"));
  L.push("");

  L.push(`## Đã phân loại (không cảnh báo): ${res.triaged} mục`);
  for (const it of detail ? res.triagedItems : res.triagedItems.slice(0, 10)) L.push(renderRow(it, "triaged"));
  if (!detail && res.triagedItems.length > 10) L.push(`... còn ${res.triagedItems.length - 10} mục nữa.`);
  L.push("");

  L.push(`## Lệch định dạng: ${res.deviations.length} dòng`);
  for (const d of detail ? res.deviations : res.deviations.slice(0, 5)) {
    L.push(`- ${d.file}:${d.line}: thiếu ${d.missing.join(" và ")}`);
  }
  if (!detail && res.deviations.length > 5) L.push(`... còn ${res.deviations.length - 5} dòng nữa.`);
  L.push("");

  L.push(`## Hạn không thống nhất: ${res.conflicts.length} cặp`);
  for (const c of res.conflicts.slice(0, 10)) L.push(conflictRow(c, model));
  if (res.conflicts.length > 10) L.push(`... còn ${res.conflicts.length - 10} cặp nữa (xem conflicts trong --json).`);

  if (res.warnings.length > 0) {
    L.push("");
    L.push("## Cảnh báo đọc dữ liệu");
    for (const w of res.warnings.slice(0, 10)) L.push(`- ${w}`);
  }
  return L.join("\n");
}

/* ───────── Entry ───────── */

export async function runDeadlines(a: {
  hub?: string;
  now?: string;
  detail?: boolean;
  subject?: string;
}): Promise<OpResult> {
  const ctx = await loadCtx(a);
  const subjectKey = a.subject?.trim() ? resolveSubject(ctx.model.subjects, a.subject).key : undefined;
  const journal = await readJournal(ctx.hub);
  const res = computeDeadlines(ctx, journal, subjectKey);
  return { text: renderDeadlines(res, ctx.model, { detail: a.detail }), data: res };
}
