import { existsSync } from "node:fs";
import {
  findTaskById,
  loadCtx,
  type Ctx,
  type TaskItem,
} from "./hub.js";
import {
  buildItems,
  decisionFor,
  excludesTask,
  latestById,
  sortItems,
  type DeadlineItem,
} from "./deadlines.js";
import { appendRecord, ensureSiriusDir, readJournal, triageFilePath, type JournalData } from "./journal.js";
import {
  TriageDecisionInputSchema,
  formatZodIssues,
  type OpResult,
  type TriageDecision,
  type TriageRecord,
} from "./schema.js";
import { z } from "zod";
import {
  atomicWriteFile,
  closestN,
  contentTokens,
  fmtVi,
  isValidDateStr,
  jaccard,
  localDateStr,
  localIso,
  localTimeStr,
  numberTokens,
  plainText,
  readJson,
  sameSet,
  tokenSeq,
  truncate,
} from "./util.js";

/* ───────── Suggest ───────── */

export interface Replacement {
  id: string;
  file: string;
  line: number;
  deadline: string;
  text: string;
  score: number;
  strong: boolean;
}

export interface Suggestion {
  id: string;
  file: string;
  line: number;
  deadline: string;
  priority: string | null;
  text: string;
  countdown: string;
  decision: "superseded" | "parked" | "active";
  reason: string;
  note: string;
  replacement?: Replacement;
  alsoIn?: string[];
}

export interface RecordTemplate {
  id: string;
  decision: TriageDecision;
  replacedBy?: string;
  note: string;
}

export interface SuggestResult {
  now: string;
  before?: string;
  counts: { total: number; superseded: number; parked: number; active: number };
  suggestions: Suggestion[];
  byBoard: Record<string, Suggestion[]>;
  record: RecordTemplate[];
}

/** True when R says "thay ..." (replaces) and one of the next 6 tokens is a token of T. */
function strongSupersede(rText: string, tTokens: Set<string>): boolean {
  const seq = tokenSeq(rText);
  for (let i = 0; i < seq.length; i++) {
    if (seq[i] !== "thay") continue;
    if (seq[i + 1] === "doi") continue; // "thay đổi" = change, not replace
    for (let j = i + 1; j <= i + 6 && j < seq.length; j++) {
      if (tTokens.has(seq[j]!)) return true;
    }
  }
  return false;
}

const OVERDUE_PARK_MS = 14 * 86400000;
/** A token shared by two tasks counts as informative when at most this many task lines of the subject contain it. */
const RARE_DF = 3;

export function computeSuggestions(ctx: Ctx, journal: JournalData, before?: string): SuggestResult {
  const { items } = buildItems(ctx, journal);
  const overdue = sortItems(items.filter((i) => i.kind === "task" && i.remainingMs < 0));
  const latest = latestById(journal.triage);
  const tokenCache = new Map<string, Set<string>>();
  const tokensOf = (t: TaskItem): Set<string> => {
    let s = tokenCache.get(t.id);
    if (!s) {
      s = contentTokens(t.text);
      tokenCache.set(t.id, s);
    }
    return s;
  };
  const numberCache = new Map<string, Set<string>>();
  const numbersOf = (t: TaskItem): Set<string> => {
    let s = numberCache.get(t.id);
    if (!s) {
      s = numberTokens(t.text);
      numberCache.set(t.id, s);
    }
    return s;
  };
  // Document frequency of each token over all task lines of a subject (checked and unchecked).
  const dfCache = new Map<string, Map<string, number>>();
  const dfOf = (subject: string): Map<string, number> => {
    let m = dfCache.get(subject);
    if (m) return m;
    m = new Map<string, number>();
    for (const x of ctx.model.tasks) {
      if (x.subject !== subject) continue;
      for (const tok of tokensOf(x)) m.set(tok, (m.get(tok) ?? 0) + 1);
    }
    dfCache.set(subject, m);
    return m;
  };
  const eligible = (r: TaskItem): boolean => {
    if (r.checked || !r.deadline) return false;
    const rec = decisionFor(r, latest);
    return !(rec && excludesTask(rec, ctx.today));
  };

  const suggestions: Suggestion[] = [];
  for (const it of overdue) {
    const t = ctx.model.tasks.find((x) => x.id === it.id);
    if (!t) continue;
    const tt = tokensOf(t);
    // Candidates: later-deadline tasks on the SAME board; for a watchlist line also the subject's project board.
    const cands = ctx.model.tasks.filter((r) => {
      if (r.id === t.id || !eligible(r) || (r.deadline as string) <= (t.deadline as string)) return false;
      if (r.file === t.file) return true;
      return t.board === "watchlist" && t.subject !== "hub" && r.board === "project" && r.subject === t.subject;
    });
    // Guards against siblings of one sequence ("Chủ đề 01" vs "Chủ đề 03", "stroke" vs "mnist") that merely
    // share boilerplate words: for the score path the numbers must agree and at least one shared token must be
    // rare among the subject's tasks. The explicit "thay ..." signal bypasses both guards.
    const df = dfOf(t.subject);
    const nt = numbersOf(t);
    let best: { r: TaskItem; score: number; strong: boolean } | undefined;
    for (const r of cands) {
      const rt = tokensOf(r);
      const score = jaccard(tt, rt);
      const strong = strongSupersede(r.text, tt);
      if (!strong) {
        if (score < 0.2) continue;
        const nr = numbersOf(r);
        if (nt.size > 0 && nr.size > 0 && !sameSet(nt, nr)) continue;
        let rare = false;
        for (const x of tt) {
          if (rt.has(x) && (df.get(x) ?? 0) <= RARE_DF) {
            rare = true;
            break;
          }
        }
        if (!rare) continue;
      }
      const better =
        !best || (strong && !best.strong) || (strong === best.strong && score > best.score);
      if (better) best = { r, score, strong };
    }

    const base = {
      id: t.id,
      file: t.file,
      line: t.line,
      deadline: t.deadline as string,
      priority: t.priority,
      text: t.text,
      countdown: it.countdown,
      ...(it.alsoIn?.length ? { alsoIn: [...it.alsoIn] } : {}),
    };
    if (best && (best.strong || best.score >= 0.2)) {
      const rep: Replacement = {
        id: best.r.id,
        file: best.r.file,
        line: best.r.line,
        deadline: best.r.deadline as string,
        text: best.r.text,
        score: Math.round(best.score * 100) / 100,
        strong: best.strong,
      };
      suggestions.push({
        ...base,
        decision: "superseded",
        reason: best.strong
          ? 'task mới hơn ghi "thay ..." và trùng từ khóa với việc này'
          : `trùng từ khóa với task mới hơn (độ giống ${fmtVi(best.score, 2)})`,
        note: `thay bởi ${rep.file}:${rep.line}`,
        replacement: rep,
      });
    } else if (before && (t.deadline as string).slice(0, 10) < before) {
      suggestions.push({
        ...base,
        decision: "superseded",
        reason: `hạn trước mốc ${before}`,
        note: `thuộc kế hoạch trước ${before}`,
      });
    } else if (-it.remainingMs > OVERDUE_PARK_MS) {
      suggestions.push({
        ...base,
        decision: "parked",
        reason: "quá hạn trên 14 ngày, chưa thấy task thay thế",
        note: "quá hạn trên 14 ngày, chưa thấy task thay thế",
      });
    } else {
      suggestions.push({
        ...base,
        decision: "active",
        reason: "chưa quá 14 ngày và chưa thấy task thay thế",
        note: "vẫn còn giá trị: làm ngay hoặc dời hạn trong file",
      });
    }
  }

  const byBoard: Record<string, Suggestion[]> = {};
  for (const s of suggestions) (byBoard[s.file] ??= []).push(s);
  const record: RecordTemplate[] = suggestions.map((s) => ({
    id: s.id,
    decision: s.decision,
    ...(s.replacement ? { replacedBy: s.replacement.id } : {}),
    note: s.note,
  }));
  const counts = {
    total: suggestions.length,
    superseded: suggestions.filter((s) => s.decision === "superseded").length,
    parked: suggestions.filter((s) => s.decision === "parked").length,
    active: suggestions.filter((s) => s.decision === "active").length,
  };
  return { now: localIso(ctx.now), ...(before ? { before } : {}), counts, suggestions, byBoard, record };
}

const DECISION_LABEL: Record<string, string> = {
  superseded: "đã bị thay thế",
  parked: "tạm gác",
  snoozed: "dời cảnh báo",
  active: "vẫn còn giá trị",
};

export function renderSuggestions(res: SuggestResult, nowText: string): string {
  const L: string[] = [];
  L.push(`# Gợi ý phân loại việc quá hạn (${nowText})`);
  L.push(
    'Đây chỉ là gợi ý. Hãy cho người học xem và chỉ ghi các quyết định họ đã xác nhận trong chat (sirius_triage { action: "record" }).',
  );
  L.push("");
  if (res.counts.total === 0) {
    L.push("Không có việc quá hạn nào chưa được phân loại.");
    return L.join("\n");
  }
  L.push(
    `Tổng: ${res.counts.total} việc quá hạn chưa phân loại: thay thế ${res.counts.superseded}, tạm gác ${res.counts.parked}, còn giá trị ${res.counts.active}.`,
  );
  for (const [file, list] of Object.entries(res.byBoard)) {
    L.push("");
    L.push(`## ${file} (${list.length})`);
    for (const s of list) {
      L.push(
        `- id ${s.id}, dòng ${s.line}, hạn ${s.deadline}, ${s.countdown} [${s.priority ?? "P?"}]: ${truncate(plainText(s.text), 110)}${
          s.alsoIn?.length ? ` (cũng có ở ${s.alsoIn.join(", ")})` : ""
        }`,
      );
      L.push(`  - Gợi ý: ${s.decision} (${DECISION_LABEL[s.decision] ?? s.decision}): ${s.reason}`);
      if (s.replacement) {
        L.push(
          `  - Thay bởi: id ${s.replacement.id} (${s.replacement.file}:${s.replacement.line}, hạn ${s.replacement.deadline}): ${truncate(plainText(s.replacement.text), 90)}`,
        );
      }
    }
  }
  L.push("");
  L.push("## Mảng JSON để ghi sau khi người học xác nhận");
  L.push("```json");
  L.push(JSON.stringify(res.record, null, 2));
  L.push("```");
  return L.join("\n");
}

/* ───────── triage.json (derived file for pick_today.py) ───────── */

export interface TriageFileEntry {
  taskId: string;
  file: string;
  line: number;
  raw: string;
  deadlineRaw?: string;
  text: string;
  decision: TriageDecision;
  until?: string;
  replacedBy?: string;
  note?: string;
  at: string;
  /** Other lines that were merged into this task (e.g. the ACTIVE_LEARNING.md watchlist copy). */
  copies?: { file: string; line: number; raw: string }[];
}

/** JSON with every non-ASCII character escaped, so a reader with the wrong default encoding still matches. */
export function asciiJson(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(
    /[\u007f-\uffff]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

export function deriveTriageEntries(ctx: Ctx, journal: JournalData): TriageFileEntry[] {
  const latest = latestById(journal.triage);
  const entries: TriageFileEntry[] = [];
  for (const t of ctx.model.tasks) {
    if (t.checked) continue;
    const rec = decisionFor(t, latest);
    if (!rec || !excludesTask(rec, ctx.today)) continue;
    entries.push({
      taskId: t.id,
      file: t.file,
      line: t.line,
      raw: t.raw,
      ...(t.deadlineRaw ? { deadlineRaw: t.deadlineRaw } : {}),
      text: t.text,
      decision: rec.decision,
      ...(rec.decision === "snoozed" && rec.until ? { until: rec.until } : {}),
      ...(rec.replacedBy ? { replacedBy: rec.replacedBy } : {}),
      ...(rec.note ? { note: rec.note } : {}),
      at: rec.at,
      ...(t.copies.length ? { copies: t.copies.map((c) => ({ file: c.file, line: c.line, raw: c.raw })) } : {}),
    });
  }
  entries.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return entries;
}

/**
 * Rewrite <hub>/.sirius/triage.json from the latest decisions and the CURRENT task lines.
 * force: always write (triage record). Otherwise write only when the entries changed or the file is missing
 * and there is something to say (triage list heals after manual edits).
 */
export async function refreshTriageFile(
  ctx: Ctx,
  journal: JournalData,
  force: boolean,
): Promise<{ entries: TriageFileEntry[]; written: boolean }> {
  const entries = deriveTriageEntries(ctx, journal);
  const path = triageFilePath(ctx.hub);
  if (!force) {
    const exists = existsSync(path);
    if (!exists && entries.length === 0 && journal.triage.length === 0) return { entries, written: false };
    if (exists) {
      const cur = await readJson<{ entries?: unknown }>(path);
      if (cur && JSON.stringify(cur.entries) === JSON.stringify(entries)) return { entries, written: false };
    }
  }
  await ensureSiriusDir(ctx.hub);
  await atomicWriteFile(path, asciiJson({ v: 1, updated: localIso(ctx.now), entries }) + "\n");
  return { entries, written: true };
}

/* ───────── Record ───────── */

const DecisionsSchema = z.array(TriageDecisionInputSchema).min(1, "decisions không được rỗng");

export async function recordDecisions(ctx: Ctx, journal: JournalData, raw: unknown): Promise<OpResult> {
  let input: unknown = raw;
  if (input && typeof input === "object" && !Array.isArray(input) && "decisions" in (input as object)) {
    input = (input as { decisions: unknown }).decisions;
  }
  const parsed = DecisionsSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(
      `decisions không hợp lệ:\n${formatZodIssues(parsed.error.issues, Object.keys(TriageDecisionInputSchema.shape)).join("\n")}`,
    );
  }
  const decisions = parsed.data;
  const errors: string[] = [];
  const allIds = ctx.model.allTasks.map((t) => t.id);
  const describe = (t: TaskItem) => `${t.file}:${t.line} ${truncate(plainText(t.text), 60)}`;
  const resolved: { d: (typeof decisions)[number]; task: TaskItem; replacedBy?: string }[] = [];

  decisions.forEach((d, i) => {
    const where = `decisions[${i}]`;
    const task = findTaskById(ctx.model, d.id);
    if (!task) {
      const near = closestN(d.id, allIds, 3)
        .map((id) => {
          const t = findTaskById(ctx.model, id) ?? ctx.model.allTasks.find((x) => x.id === id);
          return t ? `${id} (${describe(t)})` : id;
        })
        .join("; ");
      errors.push(`${where}: không tìm thấy id "${d.id}"${near ? `. Gần nhất: ${near}` : ""}`);
      return;
    }
    if (d.decision === "snoozed") {
      if (!d.until) {
        errors.push(`${where}: snoozed cần until (YYYY-MM-DD).`);
        return;
      }
      if (!isValidDateStr(d.until)) {
        errors.push(`${where}: until không hợp lệ "${d.until}".`);
        return;
      }
      if (d.until < ctx.today) {
        errors.push(`${where}: until ${d.until} đã qua; cần từ hôm nay (${ctx.today}) trở đi.`);
        return;
      }
    } else if (d.until) {
      errors.push(`${where}: until chỉ dùng với snoozed.`);
      return;
    }
    let replacedBy: string | undefined;
    if (d.replacedBy) {
      if (d.decision !== "superseded") {
        errors.push(`${where}: replacedBy chỉ dùng với superseded.`);
        return;
      }
      const rep = findTaskById(ctx.model, d.replacedBy);
      if (!rep) {
        const near = closestN(d.replacedBy, allIds, 3).join(", ");
        errors.push(`${where}: replacedBy "${d.replacedBy}" không khớp task nào${near ? `. Gần nhất: ${near}` : ""}`);
        return;
      }
      replacedBy = rep.id;
    }
    resolved.push({ d, task, ...(replacedBy ? { replacedBy } : {}) });
  });

  if (errors.length > 0) {
    throw new Error(`Không ghi gì cả vì ${errors.length} lỗi:\n- ${errors.join("\n- ")}`);
  }

  const at = localIso(ctx.now);
  const written: TriageRecord[] = [];
  for (const { d, task, replacedBy } of resolved) {
    const rec: TriageRecord = {
      v: 1,
      type: "triage",
      at,
      taskId: task.id,
      decision: d.decision,
      ...(d.decision === "snoozed" && d.until ? { until: d.until } : {}),
      ...(replacedBy ? { replacedBy } : {}),
      ...(d.note?.trim() ? { note: d.note.trim() } : {}),
      file: task.file,
      line: task.line,
      text: task.text.slice(0, 160),
      raw: task.raw,
      ...(task.deadlineRaw ? { deadlineRaw: task.deadlineRaw } : {}),
    };
    await appendRecord(ctx.hub, rec);
    written.push(rec);
  }

  // Refresh the derived file for pick_today.py from the journal INCLUDING the new records.
  const after = await readJournal(ctx.hub);
  const file = await refreshTriageFile(ctx, after, true);

  const lines = [`Đã ghi ${written.length} quyết định phân loại:`];
  for (const r of written) {
    const t = resolved.find((x) => x.task.id === r.taskId)?.task;
    lines.push(
      `- ${r.decision}${r.until ? ` đến ${r.until}` : ""}: ${t ? describe(t) : r.text} (id ${r.taskId})${r.note ? ` - ${r.note}` : ""}`,
    );
  }
  lines.push(`Đã cập nhật .sirius/triage.json (${file.entries.length} mục đang loại khỏi cảnh báo).`);
  lines.push("Chạy lại sirius_deadlines để thấy kết quả. Sirius không sửa bất kỳ tệp TASKS.md nào.");
  return { text: lines.join("\n"), data: { recorded: written, triageFile: { entries: file.entries.length } } };
}

/* ───────── List ───────── */

export interface ListedDecision {
  taskId: string;
  decision: TriageDecision;
  until?: string;
  replacedBy?: string;
  note?: string;
  at: string;
  state: "excluding" | "inactive" | "orphaned";
  file: string;
  line: number;
  text: string;
}

export async function listDecisions(ctx: Ctx, journal: JournalData): Promise<OpResult> {
  const latest = latestById(journal.triage);
  const rows: ListedDecision[] = [];
  for (const rec of latest.values()) {
    const task = findTaskById(ctx.model, rec.taskId);
    let state: ListedDecision["state"];
    if (!task) state = "orphaned";
    else state = excludesTask(decisionFor(task, latest) ?? rec, ctx.today) ? "excluding" : "inactive";
    rows.push({
      taskId: rec.taskId,
      decision: rec.decision,
      ...(rec.until ? { until: rec.until } : {}),
      ...(rec.replacedBy ? { replacedBy: rec.replacedBy } : {}),
      ...(rec.note ? { note: rec.note } : {}),
      at: rec.at,
      state,
      file: task ? task.file : rec.file,
      line: task ? task.line : rec.line,
      text: task ? task.text : rec.text,
    });
  }
  rows.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  const file = await refreshTriageFile(ctx, journal, false);

  const L: string[] = [];
  L.push(`# Quyết định phân loại (${localDateStr(ctx.now)} ${localTimeStr(ctx.now)})`);
  const excluding = rows.filter((r) => r.state === "excluding");
  const inactive = rows.filter((r) => r.state === "inactive");
  const orphaned = rows.filter((r) => r.state === "orphaned");
  const fmt = (r: ListedDecision) =>
    `- ${r.decision}${r.until ? ` đến ${r.until}` : ""}: ${r.file}:${r.line} ${truncate(plainText(r.text), 90)} (id ${r.taskId}, ghi lúc ${r.at})${r.note ? ` - ${r.note}` : ""}`;
  L.push("");
  L.push(`## Đang loại khỏi cảnh báo: ${excluding.length} mục`);
  for (const r of excluding) L.push(fmt(r));
  L.push("");
  L.push(`## Đã ghi nhưng không loại khỏi cảnh báo: ${inactive.length} mục`);
  for (const r of inactive) L.push(fmt(r));
  L.push("");
  L.push(`## Mồ côi: ${orphaned.length} mục`);
  if (orphaned.length > 0) {
    L.push("Id không còn khớp dòng nào (có thể bạn đã sửa nội dung hoặc hạn của dòng đó). Cần phân loại lại nếu dòng vẫn còn.");
  }
  for (const r of orphaned) L.push(fmt(r));
  if (journal.invalid > 0) {
    L.push("");
    L.push(`Ghi chú: ${journal.invalid} dòng journal không hợp lệ đã bị bỏ qua.`);
  }
  L.push("");
  L.push(
    file.written
      ? `Đã làm mới .sirius/triage.json (${file.entries.length} mục đang loại khỏi cảnh báo).`
      : `.sirius/triage.json đã khớp trạng thái hiện tại (${file.entries.length} mục).`,
  );
  return {
    text: L.join("\n"),
    data: {
      decisions: rows,
      orphaned,
      triageFile: { entries: file.entries.length, written: file.written },
    },
  };
}

/* ───────── Entry ───────── */

export async function runTriage(a: {
  action: string;
  hub?: string;
  now?: string;
  before?: string;
  decisions?: unknown;
}): Promise<OpResult> {
  const action = (a.action ?? "").trim().toLowerCase();
  if (action !== "suggest" && action !== "record" && action !== "list") {
    throw new Error(`action không hợp lệ: "${a.action}". Hợp lệ: suggest | record | list.`);
  }
  const ctx = await loadCtx(a);
  const journal = await readJournal(ctx.hub);
  if (action === "suggest") {
    const before = a.before?.trim() || undefined;
    if (before && !isValidDateStr(before)) throw new Error(`before không hợp lệ: "${before}" (cần YYYY-MM-DD).`);
    const res = computeSuggestions(ctx, journal, before);
    return { text: renderSuggestions(res, `${localDateStr(ctx.now)} ${localTimeStr(ctx.now)}`), data: res };
  }
  if (action === "record") {
    if (a.decisions === undefined) throw new Error("record cần decisions: [{ id, decision, until?, replacedBy?, note? }].");
    return recordDecisions(ctx, journal, a.decisions);
  }
  return listDecisions(ctx, journal);
}

