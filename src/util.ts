import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const VERSION = "0.1.0";

export function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export const hash = (s: string, n = 8): string => createHash("sha1").update(s).digest("hex").slice(0, n);

export function randomHex(n = 8): string {
  return randomBytes(Math.ceil(n / 2)).toString("hex").slice(0, n);
}

/** Forward-slash form of a path (the hub uses forward slashes everywhere). */
export const fwd = (p: string): string => p.replace(/\\/g, "/");

/** Lowercase forward-slash form, used as a comparison key on case-insensitive file systems. */
export const lc = (p: string): string => fwd(p).toLowerCase();

/* ───────── File helpers ───────── */

/** Atomic file write via temp file + rename to prevent corruption */
export async function atomicWriteFile(targetPath: string, content: string | Buffer): Promise<void> {
  const dir = dirname(targetPath);
  await mkdir(dir, { recursive: true });
  const tempPath = `${targetPath}.tmp.${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  try {
    await writeFile(tempPath, content, "utf8");
    await rename(tempPath, targetPath);
  } catch (err) {
    try {
      if (existsSync(tempPath)) {
        await unlink(tempPath);
      }
    } catch {
      // ignore cleanup error
    }
    throw err;
  }
}

export async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    const text = await readFile(path, "utf8");
    return JSON.parse(text.replace(/^﻿/, "")) as T;
  } catch {
    return undefined;
  }
}

export async function writeJson(path: string, data: unknown): Promise<void> {
  await atomicWriteFile(path, JSON.stringify(data, null, 2) + "\n");
}

/** Read a UTF-8 text file (BOM stripped); undefined when missing or unreadable. */
export async function readText(path: string): Promise<string | undefined> {
  try {
    const text = await readFile(path, "utf8");
    return text.replace(/^﻿/, "");
  } catch {
    return undefined;
  }
}

/** Read at most `maxBytes` from the END of a file (a partial first line is dropped). */
export async function readTextBounded(
  path: string,
  maxBytes = 8 * 1024 * 1024,
): Promise<{ text: string; truncated: boolean } | undefined> {
  try {
    const st = await stat(path);
    if (!st.isFile()) return undefined;
    if (st.size <= maxBytes) {
      const text = (await readFile(path, "utf8")).replace(/^﻿/, "");
      return { text, truncated: false };
    }
    const fh = await open(path, "r");
    try {
      const buf = Buffer.alloc(maxBytes);
      await fh.read(buf, 0, maxBytes, st.size - maxBytes);
      let text = buf.toString("utf8");
      const nl = text.indexOf("\n");
      if (nl >= 0) text = text.slice(nl + 1);
      return { text, truncated: true };
    } finally {
      await fh.close();
    }
  } catch {
    return undefined;
  }
}

/* ───────── Text helpers ───────── */

export function stripDiacritics(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}

/** Lowercase, no diacritics, single spaces. */
export function norm(s: string): string {
  return stripDiacritics(s).toLowerCase().replace(/\s+/g, " ").trim();
}

function lev(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length]!;
}

/** Levenshtein-based suggestions for corrective error messages (closest first). */
export function closestN(word: string, candidates: string[], n = 3): string[] {
  const w = norm(word);
  const scored: { c: string; d: number }[] = [];
  for (const c of candidates) {
    const b = norm(c);
    const d = lev(w, b);
    if (d <= Math.max(3, Math.floor(b.length * 0.45))) scored.push({ c, d });
  }
  scored.sort((x, y) => x.d - y.d);
  return [...new Set(scored.map((s) => s.c))].slice(0, n);
}

export function closest(word: string, candidates: string[]): string | undefined {
  return closestN(word, candidates, 1)[0];
}

/** Remove markdown link targets: [label](url) keeps the label only; bare URLs vanish. */
export function stripLinkTargets(text: string): string {
  return text.replace(/\]\([^)]*\)/g, "]").replace(/\b(?:file|https?):\/\/\S+/gi, " ");
}

/** Human display text: link labels only, no backticks, single spaces. */
export function plainText(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 3)).trimEnd() + "...";
}

const STOPWORDS = new Set<string>([
  // Vietnamese (after stripDiacritics)
  "va", "cua", "cho", "voi", "la", "de", "trong", "tren", "duoc", "nhung", "cac", "mot", "theo", "tai", "khi",
  "den", "tu", "se", "nay", "do", "co", "khong", "can", "cung", "nhu", "hay", "hoac", "thi", "ma", "neu", "ra",
  "vao", "len", "xuong", "bang", "sau", "truoc", "roi", "da", "dang", "moi", "cu", "ban", "han", "chot", "qua",
  "phai", "bi", "boi", "nao", "hoan", "thanh", "task", "tasks",
  // English
  "the", "and", "for", "with", "from", "into", "that", "this", "are", "was", "will", "has", "have", "not", "all",
  "any", "can", "each", "its", "per", "via", "using", "use", "new", "add", "then", "than", "only", "also", "you",
  "your",
  // Hub boilerplate (spec)
  "deadline", "priority", "p0", "p1", "p2", "md", "file", "d", "http", "learning", "knowledge",
]);

/** Ordered content tokens (stopwords, years and short noise removed). */
export function tokenSeq(text: string): string[] {
  const t = norm(stripLinkTargets(text));
  const out: string[] = [];
  for (const m of t.matchAll(/[a-z0-9]+(?:\.[a-z0-9]+)*/g)) {
    const tok = m[0];
    if (STOPWORDS.has(tok)) continue;
    if (/^20\d\d$/.test(tok)) continue;
    if (tok.length >= 3 || /^(m\d+(\.\d+)?|hw\d+|\d+\.\d+)$/.test(tok)) out.push(tok);
  }
  return out;
}

export function contentTokens(text: string): Set<string> {
  return new Set(tokenSeq(text));
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Standalone numbers and dotted codes in a text (dates and times removed), leading zeros ignored:
 * "Buổi 1" gives {"1"}, "Chủ đề 02" gives {"2"}, "Mốc 1.5" gives {"1.5"}.
 */
export function numberTokens(text: string): Set<string> {
  let t = norm(stripLinkTargets(text));
  t = t
    .replace(/\d{4}-\d{2}-\d{2}/g, " ")
    .replace(/\d{1,2}:\d{2}/g, " ")
    .replace(/\d{1,4}\/\d{1,4}(?:\/\d{2,4})?/g, " ");
  const out = new Set<string>();
  for (const m of t.matchAll(/(?<![a-z0-9._])(\d+(?:\.\d+)*)(?![a-z0-9]|\.\d)/g)) {
    out.add(
      m[1]!
        .split(".")
        .map((p) => String(parseInt(p, 10)))
        .join("."),
    );
  }
  return out;
}

export function sameSet(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((x) => b.has(x));
}

/* ───────── Date helpers (machine local time; the learner is UTC+7) ───────── */

export const VI_WEEKDAYS = ["Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy", "Chủ Nhật"] as const;

export const pad2 = (n: number): string => String(n).padStart(2, "0");

export function isValidDateStr(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d;
}

export function isValidTimeStr(s: string): boolean {
  return /^([01]?\d|2[0-3]):[0-5]\d$/.test(s.trim());
}

/** "8:05" -> "08:05" */
export function normTime(s: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return s.trim();
  return `${pad2(Number(m[1]))}:${m[2]}`;
}

export function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function localTimeStr(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** ISO 8601 with the local UTC offset, e.g. 2026-10-12T00:47:00+07:00 */
export function localIso(d: Date): string {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const a = Math.abs(off);
  return `${localDateStr(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}${sign}${pad2(Math.floor(a / 60))}:${pad2(a % 60)}`;
}

/** Local Date for "YYYY-MM-DD" + "HH:mm". */
export function parseLocal(date: string, time = "00:00"): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(y!, m! - 1, d!, hh ?? 0, mm ?? 0, 0, 0);
}

/** Calendar arithmetic on date strings (DST-safe). */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + n));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/** Whole days from a to b (b - a). */
export function diffDays(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by!, bm! - 1, bd!) - Date.UTC(ay!, am! - 1, ad!)) / 86400000);
}

/** Monday = 0 ... Sunday = 6 */
export function weekdayIdx(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return (new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay() + 6) % 7;
}

export function viWeekday(date: string): string {
  return VI_WEEKDAYS[weekdayIdx(date)] ?? "";
}

export function weekStartOf(date: string): string {
  return addDays(date, -weekdayIdx(date));
}

/** ISO week (Monday..Sunday) with the ISO week-numbering year. */
export function isoWeekOf(date: string): { year: number; week: number; label: string } {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  const dayNum = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - dayNum + 3); // Thursday of this week
  const isoYear = dt.getUTCFullYear();
  const firstThu = new Date(Date.UTC(isoYear, 0, 4));
  const firstThuDay = (firstThu.getUTCDay() + 6) % 7;
  firstThu.setUTCDate(firstThu.getUTCDate() - firstThuDay + 3);
  const week = 1 + Math.round((dt.getTime() - firstThu.getTime()) / (7 * 86400000));
  return { year: isoYear, week, label: `${isoYear}-W${pad2(week)}` };
}

/** "2026-10-12" -> "12/10" */
export function fmtDM(date: string): string {
  const [, m, d] = date.split("-");
  return `${d}/${m}`;
}

/** Decimal comma, fixed digits: 1.6 -> "1,6" */
export function fmtVi(n: number, digits = 1): string {
  return n.toFixed(digits).replace(".", ",");
}

/** Hours with a decimal comma and no trailing ",0": 5 -> "5", 6.5 -> "6,5" */
export function fmtHours(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : String(r).replace(".", ",");
}

/**
 * Vietnamese countdown. Positive input = time remaining, negative = overdue.
 * >= 1 day -> "D ngày H giờ"; < 1 day -> "H giờ M phút" (zero hours omitted).
 */
export function formatCountdown(remainingMs: number): string {
  const overdue = remainingMs < 0;
  const prefix = overdue ? "quá hạn" : "còn";
  const totalMin = Math.floor(Math.abs(remainingMs) / 60000);
  if (totalMin < 1) return `${prefix} dưới 1 phút`;
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  if (days >= 1) return `${prefix} ${days} ngày ${hours} giờ`;
  if (hours >= 1) return `${prefix} ${hours} giờ ${mins} phút`;
  return `${prefix} ${mins} phút`;
}

/** Tool param `now` -> env SIRIUS_NOW -> system clock. Date-only values mean local midnight. */
export function resolveNow(param?: string): Date {
  const raw = (param && param.trim()) || process.env.SIRIUS_NOW?.trim();
  if (!raw) return new Date();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    if (!isValidDateStr(raw)) throw new Error(`now không hợp lệ: "${raw}"`);
    return parseLocal(raw, "00:00");
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`now không hợp lệ: "${raw}" (cần ISO 8601, ví dụ 2026-10-12T00:47:00+07:00)`);
  }
  return d;
}

/* ───────── Process execution with timeout and tree termination ───────── */

export interface ProcessOutcome {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
  spawnError?: string;
}

export async function runProcess(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number; maxOutput?: number } = {},
): Promise<ProcessOutcome> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const maxOutput = options.maxOutput ?? 4 * 1024 * 1024;
  const start = Date.now();

  return new Promise<ProcessOutcome>((resolvePromise) => {
    let timedOut = false;
    let stdout = "";
    let stderr = "";
    let settled = false;

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env ?? process.env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (spawnErr) {
      resolvePromise({
        exitCode: 1,
        stdout: "",
        stderr: errMsg(spawnErr),
        timedOut: false,
        durationMs: Date.now() - start,
        spawnError: errMsg(spawnErr),
      });
      return;
    }

    const killTree = () => {
      if (child.pid === undefined) return;
      if (process.platform === "win32") {
        try {
          execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
        } catch {
          // already gone
        }
      } else {
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore
        }
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killTree();
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length < maxOutput) stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < maxOutput) stderr += chunk.toString("utf8");
    });

    const finalize = (code: number | null, spawnError?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({
        exitCode: code,
        stdout,
        stderr,
        timedOut,
        durationMs: Date.now() - start,
        ...(spawnError ? { spawnError } : {}),
      });
    };

    child.on("close", (code) => finalize(code));
    child.on("error", (err) => {
      stderr += `\n${errMsg(err)}`;
      finalize(1, errMsg(err));
    });
  });
}

/** Run async jobs with a small concurrency limit; results keep input order. */
export async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return results;
}
