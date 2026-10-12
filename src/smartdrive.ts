import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, join, parse as parsePath, relative, resolve } from "node:path";
import { errMsg, fwd, runProcess } from "./util.js";

/** Split a command line string into tokens, preserving quoted arguments. */
export function splitCommand(cmdStr: string): string[] {
  const tokens: string[] = [];
  let cur = "";
  let inQuote: "'" | '"' | null = null;
  for (let i = 0; i < cmdStr.length; i++) {
    const ch = cmdStr[i]!;
    if (inQuote) {
      if (ch === inQuote) inQuote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (/\s/.test(ch)) {
      if (cur.length > 0) {
        tokens.push(cur);
        cur = "";
      }
    } else {
      cur += ch;
    }
  }
  if (cur.length > 0) tokens.push(cur);
  return tokens;
}

/** SIRIUS_SMARTDRIVE = off | false | 0 | no disables every SmartDrive call (search and post-write hook). */
export function isSmartDriveDisabled(): boolean {
  const val = process.env.SIRIUS_SMARTDRIVE?.trim().toLowerCase();
  return val === "off" || val === "false" || val === "0" || val === "no";
}

const exeCache = new Map<string, string | null>();

export function findExecutable(candidates: string[]): string | undefined {
  const cacheKey = candidates.join("|");
  const cached = exeCache.get(cacheKey);
  if (cached !== undefined) return cached ?? undefined;
  const pathDirs = (process.env.PATH ?? "").split(process.platform === "win32" ? ";" : ":");
  const isWin = process.platform === "win32";
  for (const cand of candidates) {
    if (existsSync(cand)) {
      exeCache.set(cacheKey, cand);
      return cand;
    }
    for (const dir of pathDirs) {
      if (!dir) continue;
      const p = join(dir, cand);
      if (existsSync(p)) {
        exeCache.set(cacheKey, p);
        return p;
      }
      if (isWin && !cand.toLowerCase().endsWith(".exe")) {
        for (const ext of [".exe", ".cmd"]) {
          if (existsSync(p + ext)) {
            exeCache.set(cacheKey, p + ext);
            return p + ext;
          }
        }
      }
    }
  }
  exeCache.set(cacheKey, null);
  return undefined;
}

/** SIRIUS_SMARTDRIVE_CMD override, then `smart-drive` on PATH, then `python -m smart_drive`. */
export function resolveSmartDriveCommand(): { executable: string; baseArgs: string[] } | undefined {
  const override = process.env.SIRIUS_SMARTDRIVE_CMD?.trim();
  if (override) {
    const parts = splitCommand(override);
    if (parts.length > 0) return { executable: parts[0]!, baseArgs: parts.slice(1) };
  }
  const sd = findExecutable(["smart-drive"]);
  if (sd) return { executable: sd, baseArgs: [] };
  if (process.platform === "win32") {
    const py = findExecutable(["py"]);
    if (py) return { executable: py, baseArgs: ["-3", "-m", "smart_drive"] };
    const python = findExecutable(["python", "python3"]);
    if (python) return { executable: python, baseArgs: ["-m", "smart_drive"] };
  } else {
    const python = findExecutable(["python3", "python"]);
    if (python) return { executable: python, baseArgs: ["-m", "smart_drive"] };
  }
  return undefined;
}

/**
 * Post-write hook (ecosystem contract "post-write-hook"): after Sirius writes a learner-visible file,
 * ask SmartDrive to refresh its index for that folder. Best effort: detached, non-blocking, failures ignored.
 * Never call this for <hub>/.sirius/ (personal data).
 */
export function notifySmartDrive(dir: string): boolean {
  if (isSmartDriveDisabled()) return false;
  const cmd = resolveSmartDriveCommand();
  if (!cmd) return false;
  try {
    const child = spawn(cmd.executable, [...cmd.baseArgs, "update", resolve(dir), "--quiet"], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      try {
        if (child.pid && !child.killed) child.kill();
      } catch {
        // ignore
      }
    }, 60000);
    timer.unref();
    child.on("exit", () => clearTimeout(timer));
    child.on("error", () => clearTimeout(timer));
    child.unref();
    return true;
  } catch {
    return false;
  }
}

export interface SdEntry {
  name: string;
  /** Absolute path, forward slashes. */
  path: string;
}

/**
 * Query the SmartDrive index (never a recursive scan of the drive).
 * `smart-drive search <query> --ext <ext> --dir <hub folder under the drive root> --json --limit 200`
 */
export async function smartDriveSearch(
  hub: string,
  query: string,
  ext: string,
): Promise<{ entries: SdEntry[]; note?: string }> {
  if (isSmartDriveDisabled()) {
    return { entries: [], note: "SmartDrive đang tắt (SIRIUS_SMARTDRIVE=off): chỉ dùng SIRIUS_EVIDENCE_DIRS." };
  }
  const cmd = resolveSmartDriveCommand();
  if (!cmd) {
    return { entries: [], note: "Không thấy lệnh smart-drive: bỏ qua tìm nhãn Orion/Aurora qua chỉ mục SmartDrive." };
  }
  const root = parsePath(hub).root;
  const rel = fwd(relative(root, hub));
  const out = await runProcess(
    cmd.executable,
    [...cmd.baseArgs, "search", query, "--ext", ext, "--dir", rel, "--json", "--limit", "200"],
    { timeoutMs: 20000 },
  );
  if (out.spawnError || out.timedOut || out.exitCode !== 0) {
    return {
      entries: [],
      note: `smart-drive search "${query}" lỗi (${out.timedOut ? "quá thời gian" : out.spawnError ? errMsg(out.spawnError) : `mã ${out.exitCode}`}): bỏ qua.`,
    };
  }
  const s = out.stdout;
  const a = s.indexOf("[");
  const b = s.lastIndexOf("]");
  if (a < 0 || b < a) return { entries: [] };
  try {
    const arr = JSON.parse(s.slice(a, b + 1)) as unknown;
    if (!Array.isArray(arr)) return { entries: [] };
    const entries: SdEntry[] = [];
    for (const e of arr) {
      if (!e || typeof e !== "object") continue;
      const rec = e as Record<string, unknown>;
      const p = typeof rec.path === "string" ? rec.path : "";
      if (!p) continue;
      const name = typeof rec.name === "string" ? rec.name : basename(p);
      entries.push({ name, path: fwd(join(root, p)) });
    }
    return { entries };
  } catch {
    return { entries: [], note: `smart-drive search "${query}" trả về dữ liệu không đọc được: bỏ qua.` };
  }
}
