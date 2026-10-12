import { existsSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import type { Priority } from "./schema.js";
import {
  closestN,
  fwd,
  hash,
  isValidDateStr,
  lc,
  localDateStr,
  norm,
  pad2,
  plainText,
  readJson,
  readText,
  resolveNow,
} from "./util.js";

export const DEFAULT_HUB = "D:/02_Learning_Knowledge";
export const HUB_SUBJECT_KEY = "hub";
export const HUB_SUBJECT_NAME = "Hub / Hạ tầng";

export type BoardKind = "central" | "watchlist" | "project";

export interface Subject {
  key: string;
  name: string;
  dir: string;
  tasks?: string;
  roadmap?: string;
  milestone?: string;
  checkpoint?: string;
  nextAction?: string;
  /** "YYYY-MM-DD HH:mm" */
  deadline?: string;
  deadlineLine?: number;
  priority?: Priority;
  aliases: string[];
  adhoc?: boolean;
}

export interface GoalInfo {
  line: number;
  date?: string;
  subject?: string;
  target?: string;
  dod?: string;
  status?: string;
  deadline?: string;
  deadlineLine?: number;
  priority?: Priority;
}

export interface TaskCopy {
  id: string;
  file: string;
  line: number;
  raw: string;
  board: BoardKind;
}

export interface TaskItem {
  id: string;
  /** Path relative to the hub, forward slashes. */
  file: string;
  line: number;
  /** The full original line without the line terminator. */
  raw: string;
  checked: boolean;
  /** Normalised "YYYY-MM-DD HH:mm" (missing time = 23:59). */
  deadline: string | null;
  /** The exact trimmed text between "[Deadline:" and "]". */
  deadlineRaw: string | null;
  priority: Priority | null;
  /** Description with the Deadline and Priority tags removed, whitespace collapsed. */
  text: string;
  section: string;
  subject: string;
  board: BoardKind;
  boardOrder: number;
  /** "file:line" of merged duplicate copies and of ACTIVE_LEARNING blocks with the same deadline. */
  alsoIn: string[];
  copies: TaskCopy[];
}

export interface Deviation {
  file: string;
  line: number;
  subject: string;
  missing: string[];
  text: string;
}

export interface Board {
  /** Path relative to the hub. */
  rel: string;
  abs: string;
  kind: BoardKind;
  subject: string;
  exists: boolean;
  /** Number of checkbox lines in the file. */
  taskCount: number;
}

export interface HubModel {
  hub: string;
  subjects: Subject[];
  goal?: GoalInfo;
  boards: Board[];
  /** Task lines after merging cross-board duplicates (checked and unchecked). */
  tasks: TaskItem[];
  /** Every checkbox line, including merged copies. */
  allTasks: TaskItem[];
  deviations: Deviation[];
  warnings: string[];
  mergedCount: number;
}

export interface Ctx {
  hub: string;
  now: Date;
  today: string;
  model: HubModel;
}

/* ───────── Hub and subject resolution ───────── */

export function resolveHubPath(param?: string): string {
  const raw =
    (param && param.trim()) || process.env.SIRIUS_HUB?.trim() || process.env.POLARIS_HUB?.trim() || DEFAULT_HUB;
  return fwd(resolve(raw)).replace(/\/+$/, "") || fwd(resolve(raw));
}

export function relFromHub(hub: string, abs: string): string {
  const r = fwd(relative(hub, abs));
  return r.startsWith("..") || /^[A-Za-z]:/.test(r) ? fwd(abs) : r;
}

/** file:///D:/x%20y -> D:/x y */
export function fileUrlToPath(url: string): string {
  let p = url.trim().replace(/^file:\/\/\//i, "");
  try {
    p = decodeURIComponent(p);
  } catch {
    // keep the raw text
  }
  p = fwd(p);
  if (!/^[A-Za-z]:/.test(p) && !p.startsWith("/")) p = `/${p}`;
  return p;
}

function computeAliases(key: string, name: string, dir: string): string[] {
  const set = new Set<string>();
  const add = (s: string) => {
    const n = norm(s);
    if (n) set.add(n);
  };
  add(name);
  add(key);
  add(key.replace(/_/g, " "));
  add(basename(dir).replace(/_/g, " "));
  add(name.replace(/[^\p{L}\p{N}]+/gu, " "));
  const words = name.split(/\s+/).filter(Boolean);
  const first = (words[0] ?? "").replace(/[^\p{L}\p{N}]/gu, "");
  if ((first.match(/\p{L}/gu) ?? []).length >= 3) add(first);
  const caps = words
    .map((w) => w.replace(/^[^\p{L}\p{N}]+/u, ""))
    .filter((w) => /^\p{Lu}/u.test(w));
  if (caps.length >= 2 && caps.length <= 4) add(caps.map((w) => w.charAt(0)).join(""));
  return [...set];
}

export function makeSubject(init: {
  key: string;
  name: string;
  dir: string;
  tasks?: string;
  roadmap?: string;
  milestone?: string;
  checkpoint?: string;
  nextAction?: string;
  deadline?: string;
  deadlineLine?: number;
  priority?: Priority;
  adhoc?: boolean;
}): Subject {
  return { ...init, aliases: computeAliases(init.key, init.name, init.dir) };
}

function makeHubSubject(hub: string): Subject {
  const aliases = ["hub", "ha tang", "hub / ha tang", "hub ha tang", "workspace", "he thong", "infra"];
  return {
    key: HUB_SUBJECT_KEY,
    name: HUB_SUBJECT_NAME,
    dir: hub,
    tasks: `${hub}/TASKS.md`,
    roadmap: `${hub}/Roadmaps/MASTER_ROADMAP.md`,
    aliases,
  };
}

/** Exact key/name/alias match first, then the longest alias the text starts with (word boundary). */
export function findSubject(subjects: Subject[], text: string): Subject | undefined {
  const t = norm(text);
  if (!t) return undefined;
  for (const s of subjects) {
    if (norm(s.key) === t || norm(s.name) === t || s.aliases.includes(t)) return s;
  }
  let best: { s: Subject; len: number } | undefined;
  for (const s of subjects) {
    for (const a of [...s.aliases, norm(s.key), norm(s.name)]) {
      if (a.length < 2) continue;
      if (!t.startsWith(a)) continue;
      const next = t.charAt(a.length);
      if (next !== "" && /[a-z0-9]/.test(next)) continue;
      if (!best || a.length > best.len) best = { s, len: a.length };
    }
  }
  return best?.s;
}

export function resolveSubject(subjects: Subject[], text: string): Subject {
  const found = findSubject(subjects, text);
  if (found) return found;
  const names = subjects.flatMap((s) => [s.key, s.name]);
  const sug = closestN(text, names, 3);
  throw new Error(
    `Không nhận ra khóa "${text}".${sug.length ? ` Gần nhất: ${sug.join(", ")}.` : ""} Khóa hợp lệ: ${subjects
      .map((s) => `${s.key} (${s.name})`)
      .join("; ")}.`,
  );
}

export function subjectName(model: HubModel, key: string): string {
  return model.subjects.find((s) => s.key === key)?.name ?? key;
}

/* ───────── Deadline text ───────── */

export interface ParsedDeadline {
  date: string;
  time: string;
  /** "YYYY-MM-DD HH:mm" */
  norm: string;
}

export function parseDeadlineText(raw: string, loose = false): ParsedDeadline | undefined {
  const re = loose
    ? /^(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}):(\d{2}))?/
    : /^(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}):(\d{2}))?$/;
  const m = re.exec(raw.trim());
  if (!m) return undefined;
  const date = m[1]!;
  if (!isValidDateStr(date)) return undefined;
  const hh = m[2] !== undefined ? Number(m[2]) : 23;
  const mm = m[3] !== undefined ? Number(m[3]) : 59;
  if (hh > 23 || mm > 59) return undefined;
  const time = `${pad2(hh)}:${pad2(mm)}`;
  return { date, time, norm: `${date} ${time}` };
}

function asPriority(s: string | undefined): Priority | undefined {
  const v = (s ?? "").trim().toUpperCase();
  return v === "P0" || v === "P1" || v === "P2" ? v : undefined;
}

/* ───────── ACTIVE_LEARNING.md parser ───────── */

interface BulletField {
  value: string;
  line: number;
}

export interface ProjectBlock {
  name: string;
  headingLine: number;
  fields: Record<string, BulletField>;
}

export interface ActiveParse {
  goal?: GoalInfo;
  projects: ProjectBlock[];
}

const CHECKBOX_RE = /^(\s*)- \[([ xX])\]\s+(.*)$/;

function fieldByPrefix(fields: Record<string, BulletField>, prefix: string): BulletField | undefined {
  for (const [k, v] of Object.entries(fields)) if (k.startsWith(prefix)) return v;
  return undefined;
}

export function parseActiveLearning(content: string): ActiveParse {
  const lines = content.split(/\r?\n/);
  const projects: ProjectBlock[] = [];
  let section = "";
  let inFence = false;
  let cur: ProjectBlock | undefined;
  let goalFields: Record<string, BulletField> | undefined;
  let goalHeadingLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]!;
    if (/^\s*(```|~~~)/.test(ln)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const h2 = /^##\s+(.+?)\s*$/.exec(ln);
    if (h2) {
      section = h2[1]!;
      cur = undefined;
      if (/^today'?s dynamic goal/i.test(section)) {
        goalFields = {};
        goalHeadingLine = i + 1;
      }
      continue;
    }
    const h3 = /^###\s+(.+?)\s*$/.exec(ln);
    if (h3) {
      if (/^active projects/i.test(section)) {
        const m = /^(\d+)\.\s*(.*)$/.exec(h3[1]!);
        cur = { name: (m ? m[2]! : h3[1]!).trim(), headingLine: i + 1, fields: {} };
        projects.push(cur);
      } else {
        cur = undefined;
      }
      continue;
    }
    if (CHECKBOX_RE.test(ln)) continue;
    const b = /^\s*-\s+([^:\n]{1,60}):\s*(.*)$/.exec(ln);
    if (!b) continue;
    const key = b[1]!.trim().toLowerCase();
    const field: BulletField = { value: b[2]!.trim(), line: i + 1 };
    if (cur) {
      if (!(key in cur.fields)) cur.fields[key] = field;
    } else if (goalFields && /^today'?s dynamic goal/i.test(section)) {
      if (!(key in goalFields)) goalFields[key] = field;
    }
  }

  let goal: GoalInfo | undefined;
  if (goalFields && Object.keys(goalFields).length > 0) {
    const dl = goalFields["deadline"];
    const pd = dl ? parseDeadlineText(dl.value, true) : undefined;
    goal = {
      line: goalHeadingLine,
      date: goalFields["date"]?.value,
      subject: goalFields["subject"]?.value,
      target: goalFields["target"]?.value,
      dod: fieldByPrefix(goalFields, "definition of done")?.value,
      status: goalFields["status"]?.value,
      deadline: pd?.norm,
      deadlineLine: dl?.line,
      priority: asPriority(goalFields["priority"]?.value),
    };
  }
  return { goal, projects };
}

/**
 * Path named by a bullet value: a file:/// link (the hub's own format), an absolute path, or a path
 * relative to the hub (plain text or a relative markdown link).
 */
export function resolveRef(value: string, base: string): string | undefined {
  const v = value.trim();
  if (!v) return undefined;
  const file = /\((file:\/\/\/[^)\s]+)\)/i.exec(v);
  if (file) return fileUrlToPath(file[1]!);
  const md = /\[[^\]]*\]\(([^)\s]+)\)/.exec(v);
  let target = (md ? md[1]! : v.replace(/^`+|`+$/g, "")).trim();
  if (!target || /^[a-z][a-z0-9+.-]*:\/\//i.test(target)) return undefined;
  try {
    target = decodeURIComponent(target);
  } catch {
    // keep the raw text
  }
  if (/^[A-Za-z]:[\\/]/.test(target) || target.startsWith("/")) return fwd(target);
  return fwd(resolve(base, target));
}

function blockToSubject(block: ProjectBlock, hub: string): Subject {
  const dirField = block.fields["directory"]?.value ?? "";
  const dir = resolveRef(dirField, hub);
  const key = dir ? basename(dir) : block.name.replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "");
  const tasksPath = resolveRef(block.fields["tasks"]?.value ?? "", hub);
  const dl = block.fields["deadline"];
  const pd = dl ? parseDeadlineText(dl.value, true) : undefined;
  return makeSubject({
    key,
    name: block.name,
    dir: dir ?? `${hub}/${key}`,
    tasks: tasksPath,
    roadmap: resolveRef(block.fields["roadmap"]?.value ?? "", hub),
    milestone: block.fields["milestone"]?.value,
    checkpoint: block.fields["checkpoint"]?.value,
    nextAction: block.fields["next action"]?.value,
    deadline: pd?.norm,
    deadlineLine: dl?.line,
    priority: asPriority(block.fields["priority"]?.value),
  });
}

/* ───────── Task-line parser ───────── */

export interface RawTask {
  line: number;
  raw: string;
  checked: boolean;
  deadline: string | null;
  deadlineRaw: string | null;
  priority: Priority | null;
  text: string;
  section: string;
  /** Names of required tags that are missing or invalid. */
  missing: string[];
}

export function parseTaskLines(content: string): RawTask[] {
  const lines = content.split(/\r?\n/);
  const out: RawTask[] = [];
  let inFence = false;
  let h2 = "";
  let h3 = "";
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]!;
    if (/^\s*(```|~~~)/.test(ln)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m2 = /^##\s+(.+?)\s*$/.exec(ln);
    if (m2) {
      h2 = m2[1]!;
      h3 = "";
      continue;
    }
    const m3 = /^###\s+(.+?)\s*$/.exec(ln);
    if (m3) {
      h3 = m3[1]!;
      continue;
    }
    const m = CHECKBOX_RE.exec(ln);
    if (!m) continue;
    const rest = m[3]!;
    const dm = /\[Deadline:\s*([^\]]*)\]/i.exec(rest);
    const pm = /\[Priority:\s*([^\]]*)\]/i.exec(rest);
    const deadlineRaw = dm ? dm[1]!.trim() : null;
    const parsed = deadlineRaw !== null ? parseDeadlineText(deadlineRaw) : undefined;
    const priority = pm ? (asPriority(pm[1]) ?? null) : null;
    const missing: string[] = [];
    if (!parsed) missing.push("Deadline");
    if (!priority) missing.push("Priority");
    const text = rest
      .replace(/\[Deadline:[^\]]*\]/gi, "")
      .replace(/\[Priority:[^\]]*\]/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    out.push({
      line: i + 1,
      raw: ln,
      checked: m[2] !== " ",
      deadline: parsed ? parsed.norm : null,
      deadlineRaw,
      priority,
      text,
      section: h3 ? `${h2} / ${h3}` : h2,
      missing,
    });
  }
  return out;
}

/* ───────── Duplicate merge (cross-board) ───────── */

function boardRank(kind: BoardKind): number {
  return kind === "project" ? 0 : kind === "central" ? 1 : 2;
}

/** Normalised text used to detect the same task listed on two boards. */
export function mergeText(text: string, subjects: Subject[]): string {
  let s = text;
  const colon = s.indexOf(":");
  if (colon > 0 && colon <= 60 && findSubject(subjects, s.slice(0, colon))) s = s.slice(colon + 1);
  // Link targets are kept on purpose: two copies of the same task link to the same place.
  return norm(s)
    .replace(/[`*]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.;,\s]+$/, "")
    .trim();
}

function compatibleSubjects(a: TaskItem, b: TaskItem): boolean {
  return a.subject === b.subject || a.subject === HUB_SUBJECT_KEY || b.subject === HUB_SUBJECT_KEY;
}

/**
 * Merge task lines with the same normalised text AND the same raw deadline string.
 * Keeps the project-board copy (then central, then watchlist) and records the others in alsoIn / copies.
 * Only lines with the same checked state are merged.
 */
export function mergeDuplicates(all: TaskItem[], subjects: Subject[]): TaskItem[] {
  const order = [...all].sort(
    (a, b) => boardRank(a.board) - boardRank(b.board) || a.boardOrder - b.boardOrder || a.line - b.line,
  );
  const groups = new Map<string, TaskItem[]>();
  const keepers: TaskItem[] = [];
  for (const t of order) {
    if (!t.deadlineRaw) {
      keepers.push(t);
      continue;
    }
    const mt = mergeText(t.text, subjects);
    if (!mt) {
      keepers.push(t);
      continue;
    }
    const key = `${t.checked ? "x" : "o"}|${t.deadlineRaw}|${mt}`;
    const group = groups.get(key) ?? [];
    const host = group.find((k) => compatibleSubjects(k, t));
    if (host) {
      host.copies.push({ id: t.id, file: t.file, line: t.line, raw: t.raw, board: t.board });
      host.alsoIn.push(`${t.file}:${t.line}`);
    } else {
      group.push(t);
      groups.set(key, group);
      keepers.push(t);
    }
  }
  return keepers.sort((a, b) => a.boardOrder - b.boardOrder || a.line - b.line);
}

/* ───────── Model loading ───────── */

function splitRow(line: string): string[] {
  const t = line.trim();
  if (!t.startsWith("|")) return [];
  const cells = t.split("|").map((c) => c.trim());
  if (cells.length && cells[0] === "") cells.shift();
  if (cells.length && cells[cells.length - 1] === "") cells.pop();
  return cells;
}

interface BoardSpec {
  abs: string;
  kind: BoardKind;
  subject: string;
}

export async function loadHubModel(hub: string): Promise<HubModel> {
  if (!existsSync(hub)) throw new Error(`Không tìm thấy hub: ${hub}. Đặt --hub, SIRIUS_HUB hoặc POLARIS_HUB.`);
  const warnings: string[] = [];

  const alPath = `${hub}/ACTIVE_LEARNING.md`;
  const alContent = await readText(alPath);
  const centralPath = `${hub}/TASKS.md`;
  const centralContent = await readText(centralPath);
  if (alContent === undefined && centralContent === undefined) {
    throw new Error(`Hub không hợp lệ: thiếu cả ACTIVE_LEARNING.md và TASKS.md trong ${hub}.`);
  }
  if (alContent === undefined) warnings.push("Không tìm thấy ACTIVE_LEARNING.md: không có danh sách khóa đang học.");

  const parsed = alContent !== undefined ? parseActiveLearning(alContent) : { projects: [] as ProjectBlock[] };
  const subjects: Subject[] = parsed.projects.map((b) => blockToSubject(b, hub));
  subjects.push(makeHubSubject(hub));

  // Optional extra aliases: <hub>/.sirius/aliases.json  {"<key>": ["alias", ...]}
  const extra = await readJson<Record<string, unknown>>(`${hub}/.sirius/aliases.json`);
  if (extra && typeof extra === "object") {
    for (const [key, list] of Object.entries(extra)) {
      const s = subjects.find((x) => x.key === key);
      if (!s || !Array.isArray(list)) continue;
      for (const a of list) {
        if (typeof a === "string" && norm(a)) s.aliases.push(norm(a));
      }
    }
  }

  // Board discovery (no recursion): central, watchlist, Active Project links, router table links.
  const specs: BoardSpec[] = [];
  const seen = new Set<string>();
  const addSpec = (abs: string, kind: BoardKind, subject: string) => {
    const k = lc(abs);
    if (seen.has(k)) return;
    seen.add(k);
    specs.push({ abs: fwd(abs), kind, subject });
  };
  addSpec(centralPath, "central", HUB_SUBJECT_KEY);
  addSpec(alPath, "watchlist", HUB_SUBJECT_KEY);
  for (const s of subjects) {
    if (s.key === HUB_SUBJECT_KEY) continue;
    addSpec(s.tasks ?? `${s.dir}/TASKS.md`, "project", s.key);
  }
  if (centralContent !== undefined) {
    for (const line of centralContent.split(/\r?\n/)) {
      if (!line.trim().startsWith("|")) continue;
      const cells = splitRow(line);
      const label = plainText(cells[0] ?? "").replace(/^\d+\.\s*/, "");
      for (const m of line.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
        // file:/// links (the hub's format) or links relative to the hub
        const p = resolveRef(`[x](${m[1]!})`, hub);
        if (!p || !/\/tasks\.md$/i.test(p)) continue;
        if (seen.has(lc(p))) continue;
        const dir = lc(dirname(p));
        let subj = subjects.find((s) => lc(s.dir) === dir);
        if (!subj && label) subj = findSubject(subjects, label);
        if (!subj) {
          const key = basename(dirname(p));
          subj = makeSubject({ key, name: label || key, dir: dirname(p), tasks: p, adhoc: true });
          subjects.splice(subjects.length - 1, 0, subj);
        }
        addSpec(p, "project", subj.key);
      }
    }
  }

  const boards: Board[] = [];
  const allTasks: TaskItem[] = [];
  const deviations: Deviation[] = [];
  for (let bi = 0; bi < specs.length; bi++) {
    const spec = specs[bi]!;
    const rel = relFromHub(hub, spec.abs);
    const content = spec.abs === fwd(alPath) ? alContent : spec.abs === fwd(centralPath) ? centralContent : await readText(spec.abs);
    if (content === undefined) {
      boards.push({ rel, abs: spec.abs, kind: spec.kind, subject: spec.subject, exists: false, taskCount: 0 });
      if (spec.kind === "project" || spec.abs === fwd(centralPath)) {
        warnings.push(`Không tìm thấy bảng task: ${rel} (khóa ${spec.subject}).`);
      }
      continue;
    }
    const raws = parseTaskLines(content);
    boards.push({ rel, abs: spec.abs, kind: spec.kind, subject: spec.subject, exists: true, taskCount: raws.length });
    const relLower = rel.toLowerCase();
    for (const r of raws) {
      let subject = spec.subject;
      if (spec.kind === "watchlist") {
        const colon = r.text.indexOf(":");
        if (colon > 0 && colon <= 60) {
          const s = findSubject(subjects, r.text.slice(0, colon));
          if (s) subject = s.key;
        }
      }
      const item: TaskItem = {
        id: hash(`${relLower}|${r.deadline ?? ""}|${r.text}`, 10),
        file: rel,
        line: r.line,
        raw: r.raw,
        checked: r.checked,
        deadline: r.deadline,
        deadlineRaw: r.deadlineRaw,
        priority: r.priority,
        text: r.text,
        section: r.section,
        subject,
        board: spec.kind,
        boardOrder: bi,
        alsoIn: [],
        copies: [],
      };
      allTasks.push(item);
      if (!r.checked && r.missing.length > 0) {
        deviations.push({ file: rel, line: r.line, subject, missing: r.missing, text: r.text });
      }
    }
  }

  const goal = "goal" in parsed ? parsed.goal : undefined;
  const tasks = mergeDuplicates(allTasks, subjects);
  return {
    hub,
    subjects,
    goal,
    boards,
    tasks,
    allTasks,
    deviations,
    warnings,
    mergedCount: allTasks.length - tasks.length,
  };
}

export async function loadCtx(args: { hub?: string; now?: string }): Promise<Ctx> {
  const hub = resolveHubPath(args.hub);
  const now = resolveNow(args.now);
  const model = await loadHubModel(hub);
  return { hub, now, today: localDateStr(now), model };
}

/** Find a task by id; ids of merged copies resolve to the kept item. */
export function findTaskById(model: HubModel, id: string): TaskItem | undefined {
  const direct = model.tasks.find((t) => t.id === id);
  if (direct) return direct;
  return model.tasks.find((t) => t.copies.some((c) => c.id === id));
}

/** Every id that identifies this merged item (its own plus its copies'). */
export function taskIds(t: TaskItem): string[] {
  return [t.id, ...t.copies.map((c) => c.id)];
}
