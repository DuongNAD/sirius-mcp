import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { findSubject, HUB_SUBJECT_KEY, type HubModel, type Subject } from "./hub.js";
import { smartDriveSearch } from "./smartdrive.js";
import {
  addDays,
  errMsg,
  fwd,
  lc,
  localDateStr,
  parseLocal,
  pool,
  readJson,
  readTextBounded,
  runProcess,
} from "./util.js";

/*
 * Evidence readers: everything here is READ-ONLY and bounded. Sirius never writes into Vega, Orion,
 * Aurora/Mira, Polaris or git; it only counts what those tools already recorded.
 */

export interface Range {
  from: string;
  to: string;
}

export interface Reader<T> {
  data: T;
  notes: string[];
}

const UNKNOWN = "?";

function envList(name: string): string[] {
  return (process.env[name] ?? "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => fwd(s).replace(/\/+$/, ""));
}

function tsOf(o: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && !Number.isNaN(Date.parse(v))) return v;
  }
  return undefined;
}

function inRange(ts: string, r: Range): boolean {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(ts) ? ts : localDateStr(new Date(ts));
  return d >= r.from && d <= r.to;
}

function parseJsonl(text: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    try {
      const o = JSON.parse(t) as unknown;
      if (o && typeof o === "object" && !Array.isArray(o)) out.push(o as Record<string, unknown>);
    } catch {
      // skip malformed line
    }
  }
  return out;
}

function subjectByPath(subjects: Subject[], p: string): string | undefined {
  const lp = lc(p);
  let best: string | undefined;
  let bestLen = 0;
  for (const s of subjects) {
    if (s.key === HUB_SUBJECT_KEY) continue;
    const d = lc(s.dir);
    if ((lp === d || lp.startsWith(`${d}/`)) && d.length > bestLen) {
      best = s.key;
      bestLen = d.length;
    }
  }
  return best;
}

function bump(map: Record<string, number>, key: string, n = 1): void {
  map[key] = (map[key] ?? 0) + n;
}

/* ───────── Vega ───────── */

interface VegaCardLite {
  id?: string;
  subject?: string;
  suspended?: boolean;
  deleted?: boolean;
  due?: string;
}

async function loadVegaCards(hub: string): Promise<VegaCardLite[] | undefined> {
  const parsed = await readJson<unknown>(`${hub}/.vega/cards.json`);
  if (!parsed) return undefined;
  let list: unknown[] = [];
  if (Array.isArray(parsed)) list = parsed;
  else if (typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.cards)) list = obj.cards;
    else if (obj.cards && typeof obj.cards === "object") list = Object.values(obj.cards as object);
    else if (Array.isArray(obj.items)) list = obj.items;
  }
  const out: VegaCardLite[] = [];
  for (const c of list) {
    if (!c || typeof c !== "object") continue;
    const r = c as Record<string, unknown>;
    const fsrs = r.fsrs && typeof r.fsrs === "object" ? (r.fsrs as Record<string, unknown>) : undefined;
    const due = typeof fsrs?.due === "string" ? fsrs.due : typeof r.due === "string" ? r.due : undefined;
    out.push({
      id: typeof r.id === "string" ? r.id : undefined,
      subject: typeof r.subject === "string" ? r.subject : undefined,
      suspended: r.suspended === true,
      deleted: r.deleted === true,
      due,
    });
  }
  return out;
}

export interface VegaReviews {
  total: number;
  bySubject: Record<string, number>;
}

export async function readVegaReviews(hub: string, range: Range, subjects: Subject[]): Promise<Reader<VegaReviews>> {
  const notes: string[] = [];
  const data: VegaReviews = { total: 0, bySubject: {} };
  const rv = await readTextBounded(`${hub}/.vega/reviews.jsonl`);
  if (!rv) {
    notes.push("Vega: chưa có .vega/reviews.jsonl (chưa có lượt ôn nào).");
    return { data, notes };
  }
  if (rv.truncated) notes.push("Vega: reviews.jsonl lớn, chỉ đọc phần cuối.");
  const cards = (await loadVegaCards(hub)) ?? [];
  const subjectOfCard = new Map<string, string>();
  for (const c of cards) if (c.id && c.subject) subjectOfCard.set(c.id, c.subject);
  for (const o of parseJsonl(rv.text)) {
    if (o.rating === "deleted") continue;
    const ts = tsOf(o, ["t", "at", "timestamp", "review", "reviewed_at"]);
    if (!ts || !inRange(ts, range)) continue;
    const cardId = [o.card, o.card_id, o.cardId].find((x): x is string => typeof x === "string");
    const subjStr = (cardId ? subjectOfCard.get(cardId) : undefined) ?? (typeof o.subject === "string" ? o.subject : undefined);
    const key = (subjStr ? findSubject(subjects, subjStr)?.key : undefined) ?? UNKNOWN;
    data.total++;
    bump(data.bySubject, key);
  }
  return { data, notes };
}

export interface VegaDue {
  exists: boolean;
  total: number;
  bySubject: Record<string, number>;
}

/** Cards not suspended whose fsrs.due is on or before the end of `date` (local). */
export async function readVegaDue(hub: string, date: string, subjects: Subject[]): Promise<VegaDue> {
  const cards = await loadVegaCards(hub);
  if (!cards) return { exists: false, total: 0, bySubject: {} };
  const endOfDay = parseLocal(addDays(date, 1), "00:00").getTime() - 1;
  const out: VegaDue = { exists: true, total: 0, bySubject: {} };
  for (const c of cards) {
    if (c.suspended || c.deleted || !c.due) continue;
    const t = Date.parse(c.due);
    if (Number.isNaN(t) || t > endOfDay) continue;
    out.total++;
    bump(out.bySubject, (c.subject ? findSubject(subjects, c.subject)?.key : undefined) ?? UNKNOWN);
  }
  return out;
}

/* ───────── Orion labs ───────── */

export interface OrionAttempt {
  ts?: string;
  durationMs: number;
  passed?: boolean;
  failedCount?: number;
}

export interface LabInfo {
  dir: string;
  subject: string;
  title?: string;
  attempts: OrionAttempt[];
}

export interface OrionStats {
  attempts: number;
  durationMs: number;
  passed: number;
  failed: number;
}

function listDir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/** Orion labs: SmartDrive index (lab.json) plus SIRIUS_EVIDENCE_DIRS, each checked non-recursively. */
export async function discoverLabDirs(hub: string): Promise<Reader<string[]>> {
  const notes: string[] = [];
  const dirs = new Map<string, string>();
  const add = (d: string) => {
    if (!dirs.has(lc(d))) dirs.set(lc(d), fwd(d));
  };
  const sd = await smartDriveSearch(hub, "lab", "json");
  if (sd.note) notes.push(sd.note);
  for (const e of sd.entries) {
    if (e.name !== "lab.json") continue;
    const dir = e.path.slice(0, e.path.length - "/lab.json".length);
    if (existsSync(dir)) add(dir);
  }
  for (const d of envList("SIRIUS_EVIDENCE_DIRS")) {
    const names = listDir(d);
    if (names.includes("lab.json") || names.includes("orion-attempts.jsonl")) add(d);
  }
  return { data: [...dirs.values()].slice(0, 60), notes };
}

async function readLab(dir: string, subjects: Subject[]): Promise<LabInfo> {
  const labJson = await readJson<Record<string, unknown>>(`${dir}/lab.json`);
  const title = typeof labJson?.title === "string" ? labJson.title : undefined;
  let subject = subjectByPath(subjects, dir);
  if (!subject && typeof labJson?.subject === "string") subject = findSubject(subjects, labJson.subject)?.key;
  const attempts: OrionAttempt[] = [];
  const txt = await readTextBounded(`${dir}/orion-attempts.jsonl`, 2 * 1024 * 1024);
  if (txt) {
    for (const o of parseJsonl(txt.text)) {
      const isAttempt = o.type === "attempt" || (o.type === undefined && typeof o.durationMs === "number");
      if (!isAttempt) continue;
      const failedCount = typeof o.failedCount === "number" ? o.failedCount : undefined;
      const passed = typeof o.passed === "boolean" ? o.passed : failedCount !== undefined ? failedCount === 0 : undefined;
      attempts.push({
        ts: tsOf(o, ["timestamp", "t", "at"]),
        durationMs: typeof o.durationMs === "number" ? o.durationMs : 0,
        ...(passed !== undefined ? { passed } : {}),
        ...(failedCount !== undefined ? { failedCount } : {}),
      });
    }
  }
  return { dir, subject: subject ?? UNKNOWN, ...(title ? { title } : {}), attempts };
}

export async function loadLabs(model: HubModel): Promise<Reader<LabInfo[]>> {
  const found = await discoverLabDirs(model.hub);
  const labs: LabInfo[] = [];
  for (const d of found.data) labs.push(await readLab(d, model.subjects));
  return { data: labs, notes: found.notes };
}

export function orionStats(labs: LabInfo[], range: Range): Record<string, OrionStats> {
  const out: Record<string, OrionStats> = {};
  for (const lab of labs) {
    for (const a of lab.attempts) {
      if (!a.ts || !inRange(a.ts, range)) continue;
      const s = (out[lab.subject] ??= { attempts: 0, durationMs: 0, passed: 0, failed: 0 });
      s.attempts++;
      s.durationMs += a.durationMs;
      if (a.passed === true) s.passed++;
      else if (a.passed === false) s.failed++;
    }
  }
  return out;
}

/** The latest attempt of a lab (by timestamp; file order when no timestamps). */
export function latestAttempt(lab: LabInfo): OrionAttempt | undefined {
  let best: OrionAttempt | undefined;
  for (const a of lab.attempts) {
    if (!best) best = a;
    else if (a.ts && best.ts) {
      if (Date.parse(a.ts) >= Date.parse(best.ts)) best = a;
    } else {
      best = a;
    }
  }
  return best;
}

/** First lab of the subject that has attempts whose latest attempt did not pass all tests. */
export function findFailingLab(labs: LabInfo[], subjectKey: string): LabInfo | undefined {
  return labs.find((l) => {
    if (l.subject !== subjectKey || l.attempts.length === 0) return false;
    const last = latestAttempt(l);
    return last !== undefined && last.passed === false;
  });
}

/* ───────── Aurora and Mira ───────── */

export interface AuroraStats {
  events: number;
  byType: Record<string, number>;
}

export interface MiraStats {
  /** Mira predict events in the range. */
  predicts: number;
  /** Of those, rating "right". */
  right: number;
}

export interface AuroraMira {
  aurora: Record<string, AuroraStats>;
  mira: Record<string, MiraStats>;
}

const PROGRESS_NAME = /^(progress\.jsonl|aurora-progress-.*\.jsonl)$/i;

export async function discoverProgressFiles(hub: string): Promise<Reader<string[]>> {
  const notes: string[] = [];
  const files = new Map<string, string>();
  const add = (f: string) => {
    if (!files.has(lc(f))) files.set(lc(f), fwd(f));
  };
  const sd = await smartDriveSearch(hub, "progress", "jsonl");
  if (sd.note) notes.push(sd.note);
  for (const e of sd.entries) {
    if (PROGRESS_NAME.test(e.name) && existsSync(e.path)) add(e.path);
  }
  for (const d of envList("SIRIUS_EVIDENCE_DIRS")) {
    for (const n of listDir(d)) if (PROGRESS_NAME.test(n)) add(`${d}/${n}`);
  }
  return { data: [...files.values()].slice(0, 100), notes };
}

/**
 * Aurora events by type. Events whose slideId starts with "mira-stop-" come from Mira (the code-tracing lab):
 * they are counted separately (predict events, rating "right") and kept out of the generic Aurora count.
 */
export async function readAuroraMira(
  files: string[],
  range: Range,
  subjects: Subject[],
): Promise<Reader<AuroraMira>> {
  const notes: string[] = [];
  const data: AuroraMira = { aurora: {}, mira: {} };
  for (const f of files) {
    const txt = await readTextBounded(f, 4 * 1024 * 1024);
    if (!txt) continue;
    if (txt.truncated) notes.push(`Aurora: ${basename(f)} lớn, chỉ đọc phần cuối.`);
    const pathSubject = subjectByPath(subjects, f);
    for (const o of parseJsonl(txt.text)) {
      const ts = tsOf(o, ["t"]);
      if (!ts || !inRange(ts, range)) continue;
      const key =
        pathSubject ??
        (typeof o.course === "string" ? findSubject(subjects, o.course)?.key : undefined) ??
        UNKNOWN;
      const slideId = typeof o.slideId === "string" ? o.slideId : "";
      if (slideId.startsWith("mira-stop-")) {
        if (o.type === "predict") {
          const m = (data.mira[key] ??= { predicts: 0, right: 0 });
          m.predicts++;
          if (o.rating === "right") m.right++;
        }
        continue;
      }
      const a = (data.aurora[key] ??= { events: 0, byType: {} });
      a.events++;
      bump(a.byType, typeof o.type === "string" ? o.type : UNKNOWN);
    }
  }
  return { data, notes };
}

/* ───────── Polaris ───────── */

export interface ErrorEntry {
  date: string;
  title: string;
}

export interface PolarisStats {
  errorlogPath?: string;
  errorEntries: ErrorEntry[];
  stepsDone: number;
}

interface ReviewStepLite {
  done?: boolean;
  dueDate?: string;
  doneDate?: string;
}

interface ReviewItemLite {
  title?: string;
  type?: string;
  steps?: ReviewStepLite[];
}

async function loadReviews(dir: string): Promise<ReviewItemLite[] | undefined> {
  const r = await readJson<{ items?: ReviewItemLite[] }>(`${dir}/polaris/reviews.json`);
  if (!r || !Array.isArray(r.items)) return undefined;
  return r.items;
}

export async function readPolaris(model: HubModel, range: Range): Promise<Reader<Record<string, PolarisStats>>> {
  const out: Record<string, PolarisStats> = {};
  for (const s of model.subjects) {
    if (s.key === HUB_SUBJECT_KEY) continue;
    const stats: PolarisStats = { errorEntries: [], stepsDone: 0 };
    const logPath = `${s.dir}/polaris/errorlog.md`;
    const txt = await readTextBounded(logPath, 2 * 1024 * 1024);
    if (txt) {
      stats.errorlogPath = logPath;
      for (const m of txt.text.matchAll(/^###\s*\[(\d{4}-\d{2}-\d{2})\]\s*(.*)$/gm)) {
        const date = m[1]!;
        if (date >= range.from && date <= range.to) stats.errorEntries.push({ date, title: (m[2] ?? "").trim() });
      }
    }
    const items = await loadReviews(s.dir);
    if (items) {
      for (const it of items) {
        for (const st of it.steps ?? []) {
          if (typeof st.doneDate === "string" && st.doneDate >= range.from && st.doneDate <= range.to) stats.stepsDone++;
        }
      }
    }
    if (stats.errorEntries.length > 0 || stats.stepsDone > 0 || stats.errorlogPath) out[s.key] = stats;
  }
  return { data: out, notes: [] };
}

export interface PolarisDueStep {
  subject: string;
  title: string;
  dueDate: string;
  kind: string;
}

/** Review steps with done = false and dueDate <= date. */
export async function readPolarisDue(model: HubModel, date: string): Promise<PolarisDueStep[]> {
  const out: PolarisDueStep[] = [];
  for (const s of model.subjects) {
    if (s.key === HUB_SUBJECT_KEY) continue;
    const items = await loadReviews(s.dir);
    if (!items) continue;
    for (const it of items) {
      for (const st of it.steps ?? []) {
        if (st.done === true) continue;
        if (typeof st.dueDate === "string" && st.dueDate <= date) {
          out.push({ subject: s.key, title: it.title ?? "(không tên)", dueDate: st.dueDate, kind: it.type ?? "" });
        }
      }
    }
  }
  return out;
}

/** True when <dir>/polaris/schedule.json exists. */
export function hasPolarisSchedule(dir: string): boolean {
  return existsSync(`${dir}/polaris/schedule.json`);
}

/* ───────── Git ───────── */

export interface GitCommit {
  hash: string;
  date: string;
  subject: string;
}

export interface ToolingRepo {
  name: string;
  path: string;
  commits: GitCommit[];
}

export interface GitEvidence {
  bySubject: Record<string, GitCommit[]>;
  tooling: ToolingRepo[];
}

async function gitLog(cwd: string, range: Range, pathspec?: string): Promise<{ commits: GitCommit[]; note?: string; missing?: boolean }> {
  const args = [
    "-C",
    cwd,
    "log",
    `--since=${range.from}T00:00`,
    `--until=${range.to}T23:59:59`,
    "--format=%H%x09%ad%x09%s",
    "--date=iso-strict",
    ...(pathspec ? ["--", pathspec] : []),
  ];
  const out = await runProcess("git", args, {
    timeoutMs: 15000,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  });
  if (out.spawnError) return { commits: [], missing: true, note: "git không có trên PATH: bỏ qua bằng chứng commit." };
  if (out.timedOut) return { commits: [], note: `git log quá 15 giây tại ${cwd}: bỏ qua.` };
  if (out.exitCode !== 0) {
    const msg = out.stderr.trim().split(/\r?\n/)[0] ?? "";
    return { commits: [], note: `git log lỗi tại ${cwd}: ${msg || `mã ${out.exitCode}`}` };
  }
  const commits: GitCommit[] = [];
  for (const line of out.stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [hash = "", date = "", ...rest] = line.split("\t");
    commits.push({ hash: hash.slice(0, 7), date, subject: rest.join("\t") });
  }
  return { commits };
}

async function toolingRepos(): Promise<{ list: { name: string; path: string }[]; notes: string[] }> {
  const notes: string[] = [];
  const list = new Map<string, { name: string; path: string }>();
  const manifestPath = join(process.env.CONSTELLATION_HOME?.trim() || join(homedir(), ".constellation"), "ecosystem.json");
  const manifest = await readJson<{ servers?: { name?: string; path?: string }[] }>(manifestPath);
  if (manifest && Array.isArray(manifest.servers)) {
    for (const s of manifest.servers) {
      if (s && typeof s.path === "string" && s.path.trim()) {
        const p = fwd(s.path.trim()).replace(/\/+$/, "");
        list.set(lc(p), { name: s.name ?? basename(p), path: p });
      }
    }
  }
  const extra = envList("SIRIUS_TOOLING_DIRS");
  for (const p of extra) if (!list.has(lc(p))) list.set(lc(p), { name: basename(p), path: p });
  if (list.size === 0) notes.push("Công cụ: không có repo nào (ecosystem.json của Constellation trống hoặc không đọc được, SIRIUS_TOOLING_DIRS rỗng).");
  return { list: [...list.values()], notes };
}

export async function readGit(model: HubModel, range: Range): Promise<Reader<GitEvidence>> {
  const notes: string[] = [];
  const data: GitEvidence = { bySubject: {}, tooling: [] };
  let gitMissing = false;
  const hubHasGit = existsSync(`${model.hub}/.git`);

  type Job = { kind: "subject"; key: string; dir: string } | { kind: "tooling"; name: string; path: string };
  const jobs: Job[] = [];
  for (const s of model.subjects) {
    if (s.key === HUB_SUBJECT_KEY) continue;
    jobs.push({ kind: "subject", key: s.key, dir: s.dir });
  }
  const tr = await toolingRepos();
  notes.push(...tr.notes);
  for (const t of tr.list) jobs.push({ kind: "tooling", name: t.name, path: t.path });

  const results = await pool(jobs, 4, async (job) => {
    if (gitMissing) return { job, commits: [] as GitCommit[] };
    if (job.kind === "subject") {
      if (!existsSync(job.dir)) return { job, commits: [] as GitCommit[], note: `Thư mục khóa ${job.key} không tồn tại: ${job.dir}` };
      if (existsSync(`${job.dir}/.git`)) {
        const r = await gitLog(job.dir, range);
        return { job, ...r };
      }
      if (hubHasGit) {
        const rel = fwd(job.dir).startsWith(`${model.hub}/`) ? fwd(job.dir).slice(model.hub.length + 1) : undefined;
        if (!rel) return { job, commits: [] as GitCommit[], note: `Thư mục khóa ${job.key} nằm ngoài hub: không đọc git.` };
        const r = await gitLog(model.hub, range, rel);
        return { job, ...r };
      }
      // Neither the course folder nor the hub root has a .git: let git find an enclosing repository, limited to this folder.
      const r = await gitLog(job.dir, range, ".");
      if (r.note && !r.missing) {
        return { job, commits: [] as GitCommit[], note: `Không có git cho khóa ${job.key} (không thấy .git ở khóa, hub hoặc thư mục cha).` };
      }
      return { job, ...r };
    }
    if (!existsSync(`${job.path}/.git`)) {
      return { job, commits: [] as GitCommit[], note: `Repo công cụ ${job.name} không có .git: ${job.path}` };
    }
    const r = await gitLog(job.path, range);
    return { job, ...r };
  });

  for (const r of results) {
    const res = r as { job: Job; commits: GitCommit[]; note?: string; missing?: boolean };
    if (res.missing) gitMissing = true;
    if (res.note && !notes.includes(res.note)) notes.push(res.note);
    if (res.job.kind === "subject") data.bySubject[res.job.key] = res.commits;
    else data.tooling.push({ name: res.job.name, path: res.job.path, commits: res.commits });
  }
  return { data, notes };
}

/* ───────── Aggregate ───────── */

export interface Evidence {
  range: Range;
  vega: VegaReviews;
  orion: Record<string, OrionStats>;
  labs: number;
  aurora: Record<string, AuroraStats>;
  mira: Record<string, MiraStats>;
  polaris: Record<string, PolarisStats>;
  git: GitEvidence;
  notes: string[];
}

async function guard<T>(fallback: T, label: string, notes: string[], fn: () => Promise<Reader<T>>): Promise<T> {
  try {
    const r = await fn();
    notes.push(...r.notes);
    return r.data;
  } catch (e) {
    notes.push(`${label}: lỗi khi đọc (${errMsg(e)}).`);
    return fallback;
  }
}

export async function collectEvidence(model: HubModel, range: Range): Promise<Evidence> {
  const notes: string[] = [];
  const [labsRes, progressRes] = await Promise.all([loadLabs(model), discoverProgressFiles(model.hub)]);
  notes.push(...labsRes.notes);
  for (const n of progressRes.notes) if (!notes.includes(n)) notes.push(n);

  const vega = await guard<VegaReviews>({ total: 0, bySubject: {} }, "Vega", notes, () =>
    readVegaReviews(model.hub, range, model.subjects),
  );
  const am = await guard<AuroraMira>({ aurora: {}, mira: {} }, "Aurora", notes, () =>
    readAuroraMira(progressRes.data, range, model.subjects),
  );
  const polaris = await guard<Record<string, PolarisStats>>({}, "Polaris", notes, () => readPolaris(model, range));
  const git = await guard<GitEvidence>({ bySubject: {}, tooling: [] }, "Git", notes, () => readGit(model, range));
  const orion = orionStats(labsRes.data, range);
  // Evidence that matches no course is not hidden: say how much there is.
  const orphans: string[] = [];
  if (vega.bySubject[UNKNOWN]) orphans.push(`Vega ${vega.bySubject[UNKNOWN]} lượt ôn`);
  if (orion[UNKNOWN]?.attempts) orphans.push(`Orion ${orion[UNKNOWN]!.attempts} lần chạy`);
  if (am.aurora[UNKNOWN]?.events) orphans.push(`Aurora ${am.aurora[UNKNOWN]!.events} sự kiện`);
  if (am.mira[UNKNOWN]?.predicts) orphans.push(`Mira ${am.mira[UNKNOWN]!.predicts} sự kiện dự đoán`);
  if (orphans.length > 0) notes.push(`Bằng chứng không gắn được với khóa nào (kiểm tra bí danh hoặc thư mục): ${orphans.join(", ")}.`);
  return { range, vega, orion, labs: labsRes.data.length, aurora: am.aurora, mira: am.mira, polaris, git, notes };
}

/** Compact evidence text: "Orion 3 lần chạy, Vega 12 lượt ôn, Aurora 5 sự kiện, Mira dò code 3/4 đúng, Sổ lỗi 2, commit 4". */
export function evidenceSummary(ev: Evidence, key: string): string {
  const parts: string[] = [];
  const o = ev.orion[key];
  if (o && o.attempts > 0) parts.push(`Orion ${o.attempts} lần chạy`);
  const v = ev.vega.bySubject[key];
  if (v) parts.push(`Vega ${v} lượt ôn`);
  const a = ev.aurora[key];
  if (a && a.events > 0) parts.push(`Aurora ${a.events} sự kiện`);
  const m = ev.mira[key];
  if (m && m.predicts > 0) parts.push(`Mira dò code ${m.right}/${m.predicts} đúng`);
  const p = ev.polaris[key];
  if (p && p.errorEntries.length > 0) parts.push(`Sổ lỗi ${p.errorEntries.length}`);
  if (p && p.stepsDone > 0) parts.push(`Ôn Polaris ${p.stepsDone}`);
  const g = ev.git.bySubject[key];
  if (g && g.length > 0) parts.push(`commit ${g.length}`);
  return parts.join(", ");
}

export function subjectCommitTotal(ev: Evidence): number {
  return Object.values(ev.git.bySubject).reduce((n, list) => n + list.length, 0);
}

export function toolingCommitTotal(ev: Evidence): number {
  return ev.git.tooling.reduce((n, r) => n + r.commits.length, 0);
}

