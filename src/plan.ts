import { findSubject, type Subject } from "./hub.js";
import type { SessionKind } from "./schema.js";
import { addDays, isValidDateStr, norm, pad2, readText, weekdayIdx } from "./util.js";

export interface MinutesRange {
  min: number;
  max: number;
}

export interface HoursRange {
  min: number;
  max: number;
}

export type PlanSessionKind = SessionKind | "rest" | "buffer";

export interface PlanSession {
  subject: string | null;
  alternatives?: string[];
  kind: PlanSessionKind;
  label: string;
  minutes: MinutesRange | null;
}

export interface DayPlan {
  main: PlanSession[];
  extra: PlanSession[];
}

export interface Phase {
  id: string;
  label: string;
  start: string;
  /** null = open-ended ("Từ 21/12"). */
  end: string | null;
  budget: Record<string, HoursRange>;
  total?: HoursRange;
  /** Column labels of the budget table that match no subject. */
  unmappedColumns: string[];
  /** Weekday index (Monday = 0) -> sessions. */
  days: Record<number, DayPlan>;
  hasTemplate: boolean;
}

export interface MilestoneWeek {
  from: string;
  to: string;
  bySubject: Record<string, string>;
}

export interface Plan {
  path: string;
  exists: boolean;
  title?: string;
  baseYear: number;
  phases: Phase[];
  milestones: MilestoneWeek[];
  warnings: string[];
}

/* ───────── Table helpers ───────── */

function splitRow(line: string): string[] {
  const t = line.trim();
  const cells = t.split("|").map((c) => c.trim());
  if (cells.length && cells[0] === "") cells.shift();
  if (cells.length && cells[cells.length - 1] === "") cells.pop();
  return cells;
}

interface Table {
  headerLine: number;
  header: string[];
  rows: { line: number; cells: string[] }[];
}

/** First markdown table at or after `from` (0-based index) and before `to`. */
function readTable(lines: string[], from: number, to: number): Table | undefined {
  let i = from;
  while (i < to && !lines[i]!.trim().startsWith("|")) i++;
  if (i >= to) return undefined;
  const headerLine = i + 1;
  const header = splitRow(lines[i]!);
  i++;
  const rows: Table["rows"] = [];
  while (i < to && lines[i]!.trim().startsWith("|")) {
    const cells = splitRow(lines[i]!);
    const isSep = cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c));
    if (!isSep) rows.push({ line: i + 1, cells });
    i++;
  }
  return { headerLine, header, rows };
}

/** Year cursor: dates are given as day/month; the year bumps when a date goes backwards. */
function dateCursor(baseYear: number): (d: number, m: number) => string | undefined {
  let year = baseYear;
  let last = "";
  return (d, m) => {
    if (m < 1 || m > 12 || d < 1 || d > 31) return undefined;
    let s = `${year}-${pad2(m)}-${pad2(d)}`;
    if (last && s < last) {
      year++;
      s = `${year}-${pad2(m)}-${pad2(d)}`;
    }
    if (!isValidDateStr(s)) return undefined;
    last = s;
    return s;
  };
}

export function parseHours(cell: string): HoursRange | undefined {
  const t = norm(cell).replace(/khoang/g, "").replace(/gio/g, "").trim();
  const m = /^(\d+(?:[.,]\d+)?)(?:\s*-\s*(\d+(?:[.,]\d+)?))?$/.exec(t);
  if (!m) return undefined;
  const a = Number(m[1]!.replace(",", "."));
  const b = m[2] !== undefined ? Number(m[2].replace(",", ".")) : a;
  return { min: Math.min(a, b), max: Math.max(a, b) };
}

/* ───────── Session cells ───────── */

const MINUTES_RE = /\((\d+)(?:\s*-\s*(\d+))?\s*phút\)/i;
const CLOCK_RE = /(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/;

export function extractMinutes(seg: string): MinutesRange | null {
  const m = MINUTES_RE.exec(seg) ?? MINUTES_RE.exec(seg.normalize("NFC"));
  if (m) {
    const a = Number(m[1]);
    return { min: a, max: m[2] !== undefined ? Number(m[2]) : a };
  }
  const c = CLOCK_RE.exec(seg);
  if (c) {
    const dur = Number(c[3]) * 60 + Number(c[4]) - (Number(c[1]) * 60 + Number(c[2]));
    if (dur > 0) return { min: dur, max: dur };
  }
  return null;
}

function nameOf(part: string): string {
  return (part.split(/[,:(]/)[0] ?? "").trim();
}

function isRestSeg(n: string): boolean {
  return /^nghi(\s*\(.*\))?$/.test(n);
}

function isBufferSeg(n: string): boolean {
  return /^du phong(\s*\(.*\))?$/.test(n);
}

function isReviewSeg(n: string): boolean {
  return n.startsWith("on xuyen khoa");
}

function startsSession(seg: string, subjects: Subject[]): boolean {
  const n = norm(seg);
  if (isRestSeg(n) || isBufferSeg(n) || isReviewSeg(n) || n === "khong") return true;
  for (const part of seg.split(/\s+hoặc\s+/i)) {
    const name = nameOf(part);
    if (name && findSubject(subjects, name)) return true;
  }
  return false;
}

/** Split a cell on " và " but glue back fragments that are not sessions ("GCI: notebook và homework (90 phút)"). */
function splitSegments(cell: string, subjects: Subject[]): string[] {
  const segs: string[] = [];
  for (const raw of cell.split(/\s+và\s+/i)) {
    const t = raw.trim();
    if (!t) continue;
    const prev = segs[segs.length - 1];
    if (prev !== undefined && !startsSession(t, subjects) && extractMinutes(prev) === null) {
      segs[segs.length - 1] = `${prev} và ${t}`;
    } else {
      segs.push(t);
    }
  }
  return segs;
}

export function inferKind(label: string): SessionKind {
  const n = norm(label);
  if (/(^|[\s:,(])on(\s|$)/.test(n)) return "review";
  if (/homework|bai tap|\bhw\d*/.test(n)) return "homework";
  if (/tu cai dat|luyen|de thi|thuc hanh|practice|kata/.test(n)) return "practice";
  if (/du an|project|capstone|competition|final assignment/.test(n)) return "project";
  return "learn";
}

function parseSegment(
  seg: string,
  subjects: Subject[],
  line: number,
  warn: (line: number, msg: string) => void,
): PlanSession {
  const n = norm(seg);
  const minutes = extractMinutes(seg);
  if (isRestSeg(n)) return { subject: null, kind: "rest", label: seg, minutes: null };
  if (isBufferSeg(n)) return { subject: null, kind: "buffer", label: seg, minutes };
  if (isReviewSeg(n)) return { subject: null, kind: "review", label: "Ôn xuyên khóa", minutes };

  const parts = seg.split(/\s+hoặc\s+/i);
  const resolved: Subject[] = [];
  for (const p of parts) {
    const name = nameOf(p);
    const s = name ? findSubject(subjects, name) : undefined;
    if (s && !resolved.includes(s)) resolved.push(s);
  }
  const kind = inferKind(seg);
  if (parts.length > 1 && resolved.length >= 2) {
    if (minutes === null) warn(line, `không đọc được số phút trong "${seg}"`);
    return { subject: null, alternatives: resolved.map((s) => s.key), kind, label: seg, minutes };
  }
  const first = resolved[0];
  if (first) {
    if (minutes === null) warn(line, `không đọc được số phút trong "${seg}"`);
    return { subject: first.key, kind, label: seg, minutes };
  }
  warn(line, `không nhận ra khóa "${nameOf(seg) || seg}" trong "${seg}"; giữ nhãn gốc, subject = null`);
  return { subject: null, kind, label: seg, minutes };
}

export function parseCell(
  cell: string,
  subjects: Subject[],
  line: number,
  warn: (line: number, msg: string) => void,
): PlanSession[] {
  const t = cell.trim();
  if (!t || t === "-" || norm(t) === "khong") return [];
  return splitSegments(t, subjects).map((seg) => parseSegment(seg, subjects, line, warn));
}

/* ───────── Parser ───────── */

const WEEKDAY_NORM = ["thu hai", "thu ba", "thu tu", "thu nam", "thu sau", "thu bay", "chu nhat"];

interface SectionRange {
  start: number;
  end: number;
}

function findSections(lines: string[]): Map<number, SectionRange> {
  const heads: { n: number; idx: number }[] = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]!;
    if (/^\s*(```|~~~)/.test(ln)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^##\s+(\d+)\.\s*/.exec(ln);
    if (m) heads.push({ n: Number(m[1]), idx: i });
    else if (/^##\s+/.test(ln)) heads.push({ n: -1, idx: i });
  }
  const out = new Map<number, SectionRange>();
  for (let h = 0; h < heads.length; h++) {
    const cur = heads[h]!;
    if (cur.n < 0) continue;
    const end = heads[h + 1]?.idx ?? lines.length;
    if (!out.has(cur.n)) out.set(cur.n, { start: cur.idx, end });
  }
  return out;
}

export function parsePlan(content: string, subjects: Subject[], now: Date, path = "Roadmaps/MASTER_ROADMAP.md"): Plan {
  const lines = content.split(/\r?\n/);
  const warnings: string[] = [];
  const warn = (line: number, msg: string) => warnings.push(`MASTER_ROADMAP.md dòng ${line}: ${msg}`);

  let title: string | undefined;
  let baseYear = now.getFullYear();
  const h1 = lines.findIndex((l) => /^#\s+/.test(l));
  if (h1 >= 0) {
    title = lines[h1]!.replace(/^#\s+/, "").trim();
    const m = /(\d{4})-\d{2}-\d{2}/.exec(title);
    if (m) baseYear = Number(m[1]);
    else warn(h1 + 1, "tiêu đề không có ngày YYYY-MM-DD; dùng năm hiện tại làm năm gốc");
  } else {
    warnings.push("MASTER_ROADMAP.md: không thấy tiêu đề cấp 1; dùng năm hiện tại làm năm gốc");
  }

  const secs = findSections(lines);
  const phases: Phase[] = [];

  /* Section 3: hours budget per phase */
  const s3 = secs.get(3);
  if (!s3) {
    warnings.push("MASTER_ROADMAP.md: không thấy mục '## 3.' (ngân sách giờ theo giai đoạn).");
  } else {
    const tb = readTable(lines, s3.start + 1, s3.end);
    if (!tb) {
      warn(s3.start + 1, "mục 3 không có bảng ngân sách");
    } else {
      const cols: { idx: number; label: string; subject: Subject | null }[] = [];
      let totalIdx = -1;
      for (let c = 1; c < tb.header.length; c++) {
        const label = tb.header[c]!;
        if (norm(label).startsWith("tong")) {
          totalIdx = c;
          break;
        }
        const subj = findSubject(subjects, label.replace(/\(.*?\)/g, "").trim());
        cols.push({ idx: c, label, subject: subj ?? null });
        if (!subj) warn(tb.headerLine, `nhãn khóa "${label}" của bảng ngân sách không khớp khóa nào (bỏ cột này)`);
      }
      const cursor = dateCursor(baseYear);
      for (const row of tb.rows) {
        const first = row.cells[0] ?? "";
        const pm = /^([IVXL]+)\.\s*(.*)$/.exec(first);
        if (!pm) {
          warn(row.line, `dòng ngân sách không bắt đầu bằng số La Mã: "${first}"`);
          continue;
        }
        const id = pm[1]!;
        const rest = pm[2]!;
        const label = (/\(([^)]*)\)/.exec(rest)?.[1] ?? rest).trim();
        let start: string | undefined;
        let end: string | null = null;
        const range = /(\d{1,2})\/(\d{1,2})\s*-\s*(\d{1,2})\/(\d{1,2})/.exec(rest);
        const from = /^tu\s+(\d{1,2})\/(\d{1,2})/.exec(norm(rest));
        if (range) {
          start = cursor(Number(range[1]), Number(range[2]));
          end = cursor(Number(range[3]), Number(range[4])) ?? null;
        } else if (from) {
          start = cursor(Number(from[1]), Number(from[2]));
        }
        if (!start) {
          warn(row.line, `không đọc được ngày của giai đoạn "${first}"`);
          continue;
        }
        const budget: Record<string, HoursRange> = {};
        const unmapped: string[] = [];
        for (const col of cols) {
          const cell = row.cells[col.idx] ?? "";
          if (!col.subject) {
            unmapped.push(col.label);
            continue;
          }
          const h = parseHours(cell);
          if (!h) {
            if (cell.trim() && cell.trim() !== "-") warn(row.line, `không đọc được số giờ "${cell}" (cột ${col.label})`);
            continue;
          }
          budget[col.subject.key] = h;
        }
        const total = totalIdx >= 0 ? parseHours(row.cells[totalIdx] ?? "") : undefined;
        phases.push({
          id,
          label,
          start,
          end,
          budget,
          ...(total ? { total } : {}),
          unmappedColumns: unmapped,
          days: {},
          hasTemplate: false,
        });
      }
    }
  }

  /* Section 4: weekly template per phase */
  const s4 = secs.get(4);
  if (!s4) {
    warnings.push("MASTER_ROADMAP.md: không thấy mục '## 4.' (tuần mẫu).");
  } else {
    const heads: { idx: number; id: string }[] = [];
    for (let i = s4.start + 1; i < s4.end; i++) {
      const m = /^\*\*\s*giai doan\s+([ivxl]+)\b/.exec(norm(lines[i]!));
      if (m) heads.push({ idx: i, id: m[1]!.toUpperCase() });
    }
    if (heads.length === 0) warn(s4.start + 1, "mục 4 không có khối '**Giai đoạn ...**'");
    for (let h = 0; h < heads.length; h++) {
      const head = heads[h]!;
      const to = heads[h + 1]?.idx ?? s4.end;
      const phase = phases.find((p) => p.id === head.id);
      if (!phase) {
        warn(head.idx + 1, `giai đoạn ${head.id} có tuần mẫu nhưng không có trong ngân sách mục 3`);
        continue;
      }
      const tb = readTable(lines, head.idx + 1, to);
      if (!tb) {
        warn(head.idx + 1, `giai đoạn ${head.id} không có bảng tuần mẫu`);
        continue;
      }
      for (const row of tb.rows) {
        const day = WEEKDAY_NORM.indexOf(norm(row.cells[0] ?? ""));
        if (day < 0) {
          warn(row.line, `ô ngày không nhận ra: "${row.cells[0] ?? ""}"`);
          continue;
        }
        phase.days[day] = {
          main: parseCell(row.cells[1] ?? "", subjects, row.line, warn),
          extra: parseCell(row.cells[2] ?? "", subjects, row.line, warn),
        };
        phase.hasTemplate = true;
      }
    }
    for (const p of phases) {
      if (!p.hasTemplate) warnings.push(`MASTER_ROADMAP.md: giai đoạn ${p.id} không có tuần mẫu ở mục 4.`);
    }
  }

  /* Section 5: 10-week milestones */
  const milestones: MilestoneWeek[] = [];
  const s5 = secs.get(5);
  if (!s5) {
    warnings.push("MASTER_ROADMAP.md: không thấy mục '## 5.' (mốc 10 tuần).");
  } else {
    const tb = readTable(lines, s5.start + 1, s5.end);
    if (!tb) {
      warn(s5.start + 1, "mục 5 không có bảng mốc tuần");
    } else {
      const cols: { idx: number; subject: Subject | null }[] = [];
      for (let c = 1; c < tb.header.length; c++) {
        const label = tb.header[c]!.replace(/\(.*?\)/g, "").trim();
        const subj = findSubject(subjects, label);
        cols.push({ idx: c, subject: subj ?? null });
        if (!subj) warn(tb.headerLine, `nhãn khóa "${tb.header[c]!}" của bảng mốc tuần không khớp khóa nào (bỏ cột này)`);
      }
      const cursor = dateCursor(baseYear);
      for (const row of tb.rows) {
        const wk = (row.cells[0] ?? "").trim();
        let from: string | undefined;
        let to: string | undefined;
        const same = /^(\d{1,2})\s*-\s*(\d{1,2})\/(\d{1,2})$/.exec(wk);
        const cross = /^(\d{1,2})\/(\d{1,2})\s*-\s*(\d{1,2})\/(\d{1,2})$/.exec(wk);
        if (same) {
          from = cursor(Number(same[1]), Number(same[3]));
          to = cursor(Number(same[2]), Number(same[3]));
        } else if (cross) {
          from = cursor(Number(cross[1]), Number(cross[2]));
          to = cursor(Number(cross[3]), Number(cross[4]));
        }
        if (!from || !to) {
          warn(row.line, `ô tuần không nhận ra: "${wk}"`);
          continue;
        }
        const bySubject: Record<string, string> = {};
        for (const col of cols) {
          if (!col.subject) continue;
          const text = (row.cells[col.idx] ?? "").trim();
          if (text && text !== "-") bySubject[col.subject.key] = text;
        }
        milestones.push({ from, to, bySubject });
      }
    }
  }

  return { path, exists: true, ...(title ? { title } : {}), baseYear, phases, milestones, warnings };
}

export async function loadPlan(hub: string, subjects: Subject[], now: Date): Promise<Plan> {
  const rel = "Roadmaps/MASTER_ROADMAP.md";
  const content = await readText(`${hub}/${rel}`);
  if (content === undefined) {
    return {
      path: rel,
      exists: false,
      baseYear: now.getFullYear(),
      phases: [],
      milestones: [],
      warnings: [`Không tìm thấy ${rel}: không có tuần mẫu, ngân sách giờ và mốc tuần.`],
    };
  }
  return parsePlan(content, subjects, now, rel);
}

/* ───────── Queries ───────── */

export function getPhaseFor(plan: Plan, date: string): Phase | undefined {
  return plan.phases.find((p) => date >= p.start && (p.end === null || date <= p.end));
}

export function getDayPlan(plan: Plan, date: string): { phase: Phase; day: DayPlan | undefined } | undefined {
  const phase = getPhaseFor(plan, date);
  if (!phase) return undefined;
  return { phase, day: phase.days[weekdayIdx(date)] };
}

export interface WeekBudget {
  phase: Phase;
  bySubject: Record<string, HoursRange>;
  total: HoursRange;
}

/** Budget of the phase that contains Monday of the week. */
export function getWeekBudget(plan: Plan, weekStart: string): WeekBudget | undefined {
  const phase = getPhaseFor(plan, weekStart);
  if (!phase) return undefined;
  const total: HoursRange = { min: 0, max: 0 };
  for (const h of Object.values(phase.budget)) {
    total.min += h.min;
    total.max += h.max;
  }
  return { phase, bySubject: phase.budget, total };
}

export function getMilestones(plan: Plan, date: string): MilestoneWeek | undefined {
  return plan.milestones.find((m) => date >= m.from && date <= m.to);
}

/** Monday of the week after `weekStart`. */
export function nextWeekStart(weekStart: string): string {
  return addDays(weekStart, 7);
}
