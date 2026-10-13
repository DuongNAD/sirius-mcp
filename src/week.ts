import {
  computeDeadlines,
  decisionFor,
  excludesTask,
  latestById,
  type DeadlineResult,
} from "./deadlines.js";
import {
  collectEvidence,
  evidenceSummary,
  loadStudyEvents,
  studyActive,
  studyCoverageText,
  studySentence,
  studyTotal,
  subjectCommitTotal,
  tallyStudy,
  toolingCommitTotal,
  type Evidence,
  type StudyStats,
} from "./evidence.js";
import { HUB_SUBJECT_KEY, loadCtx, subjectName, type Ctx, type TaskItem } from "./hub.js";
import {
  COMMIT_STATUS_LABEL,
  commitStatus,
  readJournal,
  sessionDate,
  type CommitStatusCode,
  type JournalData,
} from "./journal.js";
import {
  getDayPlan,
  getMilestones,
  getWeekBudget,
  loadPlan,
  type HoursRange,
  type MinutesRange,
  type Plan,
  type PlanSession,
  type WeekBudget,
} from "./plan.js";
import type { OpResult, SessionRecord } from "./schema.js";
import { notifySmartDrive } from "./smartdrive.js";
import {
  addDays,
  atomicWriteFile,
  diffDays,
  fmtDM,
  fmtHours,
  fmtVi,
  fwd,
  isValidDateStr,
  isoWeekOf,
  pad2,
  plainText,
  truncate,
  viWeekday,
  weekStartOf,
} from "./util.js";

/* ───────── Shared statistics ───────── */

export function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export interface Capacity {
  /** The completed weeks used (newest first). */
  weeks: { label: string; weekStart: string; hours: number }[];
  /** Median weekly study hours over those weeks (undefined when fewer than 2). */
  median?: number;
  used: number;
  enough: boolean;
}

/**
 * Capacity-true budget: median weekly study hours (non-meta) over the last 3 COMPLETED ISO weeks
 * (before `currentWeekStart`) that have at least one logged study session.
 */
export function computeCapacity(sessions: SessionRecord[], currentWeekStart: string): Capacity {
  const byWeek = new Map<string, number>();
  for (const s of sessions) {
    if (s.kind === "meta") continue;
    const ws = weekStartOf(sessionDate(s));
    if (ws >= currentWeekStart) continue;
    byWeek.set(ws, (byWeek.get(ws) ?? 0) + s.minutes);
  }
  const list = [...byWeek.entries()]
    .filter(([, m]) => m > 0)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 3)
    .map(([ws, m]) => ({ label: isoWeekOf(ws).label, weekStart: ws, hours: m / 60 }));
  const enough = list.length >= 2;
  return {
    weeks: list,
    ...(enough ? { median: median(list.map((w) => w.hours)) } : {}),
    used: list.length,
    enough,
  };
}

export function capacityLines(cap: Capacity, budgetMinHours: number | undefined): string[] {
  if (!cap.enough || cap.median === undefined) return ["Chưa đủ dữ liệu: cần ít nhất 2 tuần có ghi phiên học."];
  const out = [
    `Năng lực thực tế: ${fmtHours(cap.median)} giờ/tuần (trung vị của ${cap.used} tuần gần nhất có ghi phiên học: ${cap.weeks
      .map((w) => w.label)
      .reverse()
      .join(", ")}).`,
  ];
  if (budgetMinHours !== undefined && cap.median > 0 && budgetMinHours > 1.5 * cap.median) {
    out.push(
      `Kế hoạch đang gấp ${fmtVi(budgetMinHours / cap.median, 1)} lần năng lực đã đo; nên cắt phạm vi theo nguyên tắc 7 thay vì học dồn.`,
    );
  }
  return out;
}

export interface StreakInfo {
  /** Qualifying days inside the tolerant chain. */
  streak: number;
  /** Calendar days spanned by the chain (qualifying days plus the single missed days inside it). */
  spanDays: number;
  /** Qualifying days among the last 14 days (today included). */
  last14: number;
  todayCounts: boolean;
}

/**
 * Streak tolerant to one miss: walk back from today (today counts only when it already has a qualifying
 * session); a single empty day is tolerated, two consecutive empty days end the chain.
 * Qualifying day = at least one non-meta session of >= 10 minutes.
 */
export function computeStreak(sessions: SessionRecord[], today: string): StreakInfo {
  const days = new Set<string>();
  for (const s of sessions) if (s.kind !== "meta" && s.minutes >= 10) days.add(sessionDate(s));
  const todayCounts = days.has(today);
  let d = todayCounts ? today : addDays(today, -1);
  let empty = 0;
  let streak = 0;
  let newest: string | undefined;
  let oldest: string | undefined;
  for (let i = 0; i < 400; i++) {
    if (days.has(d)) {
      streak++;
      oldest = d;
      newest ??= d;
      empty = 0;
    } else {
      empty++;
      if (empty >= 2) break;
    }
    d = addDays(d, -1);
  }
  let last14 = 0;
  for (let i = 0; i < 14; i++) if (days.has(addDays(today, -i))) last14++;
  return {
    streak,
    spanDays: newest && oldest ? diffDays(oldest, newest) + 1 : 0,
    last14,
    todayCounts,
  };
}

export interface EstimateStats {
  samples: number;
  overall?: { median: number; n: number };
  bySubject: Record<string, { median: number; n: number }>;
}

/** actual / estimate ratios over all sessions that carry an estimate (>= 3 samples per group). */
export function computeEstimates(sessions: SessionRecord[]): EstimateStats {
  const all: number[] = [];
  const per = new Map<string, number[]>();
  for (const s of sessions) {
    if (!s.estimate) continue;
    const r = s.minutes / s.estimate;
    all.push(r);
    const list = per.get(s.subject) ?? [];
    list.push(r);
    per.set(s.subject, list);
  }
  const out: EstimateStats = { samples: all.length, bySubject: {} };
  if (all.length >= 3) out.overall = { median: median(all) as number, n: all.length };
  for (const [k, list] of per) if (list.length >= 3) out.bySubject[k] = { median: median(list) as number, n: list.length };
  return out;
}

export function estimateLines(ctx: Ctx, est: EstimateStats): string[] {
  if (!est.overall) return ["Chưa đủ dữ liệu (cần ít nhất 3 phiên có ước lượng)."];
  const lines: string[] = [];
  const fx = (x: number) => fmtVi(x, 1);
  lines.push(
    `Tổng thể bạn thường mất ${fx(est.overall.median)} lần thời gian ước lượng (${est.overall.n} phiên): nhân ước lượng với ${fx(est.overall.median)}.`,
  );
  for (const [k, v] of Object.entries(est.bySubject)) {
    lines.push(
      `Bạn thường mất ${fx(v.median)} lần thời gian ước lượng cho ${subjectName(ctx.model, k)}: nhân ước lượng với ${fx(v.median)}.`,
    );
  }
  return lines;
}

export interface CommitTally {
  kept: number;
  late: number;
  missed: number;
  pending: number;
}

export function tallyCommits(journal: JournalData, now: Date, from?: string, to?: string): CommitTally {
  const t: CommitTally = { kept: 0, late: 0, missed: 0, pending: 0 };
  for (const c of journal.commits) {
    if (from && c.date < from) continue;
    if (to && c.date > to) continue;
    t[commitStatus(c, journal.sessions, now) as CommitStatusCode]++;
  }
  return t;
}

const sumMinutes = (list: SessionRecord[]): number => list.reduce((n, s) => n + s.minutes, 0);

function fmtRange(r: HoursRange): string {
  return r.min === r.max ? fmtHours(r.min) : `${fmtHours(r.min)}-${fmtHours(r.max)}`;
}

function fmtMinutesRange(m: MinutesRange | null): string {
  if (!m) return "?";
  return m.min === m.max ? String(m.min) : `${m.min}-${m.max}`;
}

function cell(s: string): string {
  return s.replace(/\|/g, "/").replace(/\r?\n/g, " ");
}

function fileUrl(abs: string): string {
  return `file:///${encodeURI(fwd(abs))}`;
}

function scrubPaths(s: string): string {
  return s.replace(/\bfile:\/\/\/\S*/gi, "...").replace(/\b[A-Za-z]:[\\/]\S*/g, "...");
}

function statusOf(bud: HoursRange | undefined, actualHours: number): string {
  if (!bud) return actualHours > 0 ? "Chưa có kế hoạch" : "-";
  if (bud.max === 0) return actualHours > 0 ? "Ngoài kế hoạch" : "-";
  if (actualHours === 0) return "Chưa học";
  return actualHours >= bud.min ? "Đúng nhịp" : "Hụt nhịp";
}

function planSessionText(s: PlanSession, ctx: Ctx): string {
  const name = s.subject
    ? subjectName(ctx.model, s.subject)
    : s.alternatives
      ? s.alternatives.map((k) => subjectName(ctx.model, k)).join(" hoặc ")
      : s.kind === "review"
        ? "Ôn xuyên khóa"
        : s.kind === "rest"
          ? "Nghỉ"
          : s.kind === "buffer"
            ? "Dự phòng"
            : ((s.label.split(/[,:(]/)[0] ?? s.label).trim() || s.label);
  return s.kind === "rest" ? name : `${name} ${fmtMinutesRange(s.minutes)}`;
}

/* ───────── Weekly review ───────── */

export interface WeekReport {
  label: string;
  from: string;
  to: string;
  markdown: string;
  data: Record<string, unknown>;
  filePath: string;
}

export async function buildWeek(
  ctx: Ctx,
  journal: JournalData,
  plan: Plan,
  ev: Evidence,
  dl: DeadlineResult,
  weekDate: string,
): Promise<WeekReport> {
  const from = weekStartOf(weekDate);
  const to = addDays(from, 6);
  const iso = isoWeekOf(from);
  const model = ctx.model;
  const L: string[] = [];

  const weekSessions = journal.sessions.filter((s) => {
    const d = sessionDate(s);
    return d >= from && d <= to;
  });
  const study = weekSessions.filter((s) => s.kind !== "meta");
  const meta = weekSessions.filter((s) => s.kind === "meta");
  const studyMin = sumMinutes(study);
  const metaMin = sumMinutes(meta);
  const studyDays = new Set(study.map(sessionDate)).size;
  const budget: WeekBudget | undefined = plan.exists ? getWeekBudget(plan, from) : undefined;
  const tally = tallyCommits(journal, ctx.now, from, to);
  const cap = computeCapacity(journal.sessions, from);
  const capLines = capacityLines(cap, budget?.total.min);

  L.push(`# Tổng kết tuần ${iso.label} (${viWeekday(from)} ${fmtDM(from)} - ${viWeekday(to)} ${fmtDM(to)})`);
  L.push("");

  /* 2. Summary */
  L.push("## Tóm tắt");
  L.push(
    budget
      ? `- Học: ${fmtHours(studyMin / 60)} giờ (${studyMin} phút) so với ngân sách ${fmtRange(budget.total)} giờ (Giai đoạn ${budget.phase.id}).`
      : `- Học: ${fmtHours(studyMin / 60)} giờ (${studyMin} phút); không có ngân sách giờ cho tuần này trong MASTER_ROADMAP.`,
  );
  L.push(`- Meta (kế hoạch, công cụ): ${fmtHours(metaMin / 60)} giờ (${metaMin} phút).`);
  L.push(`- Số ngày có học: ${studyDays}/7.`);
  L.push(
    `- Cam kết: đúng hẹn ${tally.kept}, trễ ${tally.late}, bỏ lỡ ${tally.missed}, ${COMMIT_STATUS_LABEL.pending} ${tally.pending}.`,
  );
  for (const line of capLines) L.push(`- ${line}`);
  L.push("");

  /* 3. By subject */
  L.push("## Theo khóa");
  L.push("| Khóa | Kế hoạch (giờ) | Thực tế (giờ) | Phiên | Bằng chứng | Hạn trong tuần | Trạng thái |");
  L.push("| :--- | ---: | ---: | ---: | :--- | :--- | :--- |");
  const latest = latestById(journal.triage);
  const keys: string[] = model.subjects.filter((s) => s.key !== HUB_SUBJECT_KEY).map((s) => s.key);
  const dueInWeek = (key: string): TaskItem[] =>
    model.tasks.filter((t) => {
      if (t.subject !== key || !t.deadline) return false;
      const d = t.deadline.slice(0, 10);
      if (d < from || d > to) return false;
      if (!t.checked) {
        const rec = decisionFor(t, latest);
        if (rec && excludesTask(rec, ctx.today)) return false;
      }
      return true;
    });
  const hubUsed =
    study.some((s) => s.subject === HUB_SUBJECT_KEY) ||
    dueInWeek(HUB_SUBJECT_KEY).length > 0 ||
    Boolean(evidenceSummary(ev, HUB_SUBJECT_KEY));
  if (hubUsed) keys.push(HUB_SUBJECT_KEY);
  for (const s of study) if (!keys.includes(s.subject)) keys.push(s.subject);
  const rows: Record<string, unknown>[] = [];
  let totalActualMin = 0;
  let totalSessions = 0;
  for (const key of keys) {
    const mine = study.filter((s) => s.subject === key);
    const actualMin = sumMinutes(mine);
    totalActualMin += actualMin;
    totalSessions += mine.length;
    const bud = budget?.bySubject[key];
    const due = dueInWeek(key);
    const done = due.filter((t) => t.checked).length;
    const evText = evidenceSummary(ev, key);
    const status = statusOf(bud, actualMin / 60);
    L.push(
      `| ${cell(subjectName(model, key))} | ${bud ? fmtRange(bud) : "-"} | ${fmtVi(actualMin / 60, 1)} | ${mine.length} | ${cell(evText || "-")} | ${due.length > 0 ? `${done}/${due.length}` : "-"} | ${status} |`,
    );
    rows.push({
      subject: key,
      budgetHours: bud ?? null,
      actualMinutes: actualMin,
      sessions: mine.length,
      evidence: evText,
      dueInWeek: { done, total: due.length },
      status,
    });
  }
  L.push(
    `| **Tổng** | ${budget ? fmtRange(budget.total) : "-"} | ${fmtVi(totalActualMin / 60, 1)} | ${totalSessions} | - | - | ${budget ? statusOf(budget.total, totalActualMin / 60) : "-"} |`,
  );
  L.push("");

  /* 4. Plan per day versus actual */
  L.push("## Kế hoạch theo ngày và thực tế");
  L.push("| Ngày | Kế hoạch (tuần mẫu, phút) | Thực tế (phút) |");
  L.push("| :--- | :--- | :--- |");
  const dayRows: Record<string, unknown>[] = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(from, i);
    const dp = plan.exists ? getDayPlan(plan, d) : undefined;
    let planText = "-";
    if (dp) {
      const parts = [...(dp.day?.main ?? []), ...(dp.day?.extra ?? [])].map((s) => planSessionText(s, ctx));
      planText = parts.length > 0 ? parts.join("; ") : "-";
    } else if (plan.exists) {
      planText = "(ngoài giai đoạn)";
    }
    const mine = weekSessions.filter((s) => sessionDate(s) === d);
    const per = new Map<string, number>();
    let metaDay = 0;
    for (const s of mine) {
      if (s.kind === "meta") metaDay += s.minutes;
      else per.set(s.subject, (per.get(s.subject) ?? 0) + s.minutes);
    }
    const actualParts = [...per.entries()].map(([k, n]) => `${subjectName(model, k)} ${n}`);
    if (metaDay > 0) actualParts.push(`meta ${metaDay}`);
    L.push(`| ${viWeekday(d)} ${fmtDM(d)} | ${cell(planText)} | ${actualParts.length > 0 ? cell(actualParts.join("; ")) : "-"} |`);
    dayRows.push({ date: d, plan: planText, actual: Object.fromEntries(per), metaMinutes: metaDay });
  }
  L.push("");

  /* 5. Estimates (all time) */
  const est = computeEstimates(journal.sessions);
  L.push("## Ước lượng thời gian");
  for (const line of estimateLines(ctx, est)) L.push(line);
  L.push("");

  /* 6. Deadlines */
  L.push("## Hạn chót");
  const dueAll = model.tasks.filter((t) => {
    if (!t.deadline) return false;
    const d = t.deadline.slice(0, 10);
    if (d < from || d > to) return false;
    if (!t.checked) {
      const rec = decisionFor(t, latest);
      if (rec && excludesTask(rec, ctx.today)) return false;
    }
    return true;
  });
  const dueDone = dueAll.filter((t) => t.checked).length;
  L.push(`- Việc có hạn trong tuần: ${dueDone}/${dueAll.length} đã xong, ${dueAll.length - dueDone} chưa xong.`);
  L.push(`- Hiện đang quá hạn chưa phân loại: ${dl.buckets.overdue.length} mục.`);
  const principle7: string[] = [];
  const seen = new Set<string>();
  for (const it of dl.buckets.overdue) {
    if (it.kind !== "task" || it.subject === HUB_SUBJECT_KEY || seen.has(it.subject)) continue;
    if (-it.remainingMs > 14 * 86400000) {
      seen.add(it.subject);
      principle7.push(
        `Nguyên tắc 7 (cắt phạm vi): ${subjectName(model, it.subject)} trễ hơn 2 tuần ở "${truncate(plainText(it.text), 80)}": bỏ phần Thử thách và dời lịch của khóa này, không học dồn.`,
      );
    }
  }
  for (const line of principle7) L.push(`- ${line}`);
  L.push("");

  /* 7. Study versus infrastructure */
  L.push("## Học và hạ tầng");
  const subjCommits = subjectCommitTotal(ev);
  const toolCommits = toolingCommitTotal(ev);
  const studyTot = studyTotal(ev.study);
  L.push(`- Thời gian: học ${studyMin} phút, meta ${metaMin} phút.`);
  L.push(`- Commit: ${subjCommits} trong thư mục các khóa, ${toolCommits} trong repo công cụ.`);
  if (studyActive(studyTot)) {
    L.push(`- Hỏi đáp có nguồn (Rigel): ${studySentence(studyTot)}. Tính là bằng chứng học.`);
  }
  const toolHeavy = (metaMin > studyMin && metaMin > 0) || (toolCommits > 0 && toolCommits > 2 * subjCommits);
  if (toolHeavy) L.push("Tuần này thời gian làm công cụ nhiều hơn thời gian học.");
  L.push("");

  /* 8. Sunday ritual */
  L.push("## Cho nghi thức Chủ Nhật");
  const logs = Object.entries(ev.polaris).filter(([, p]) => p.errorEntries.length > 0 && p.errorlogPath);
  if (logs.length > 0) {
    L.push("Sổ lỗi có mục mới trong tuần:");
    for (const [k, p] of logs) {
      L.push(`- ${subjectName(model, k)}: ${p.errorEntries.length} mục, [errorlog.md](${fileUrl(p.errorlogPath as string)})`);
    }
  } else {
    L.push("Sổ lỗi: không có mục mới trong tuần.");
  }
  const thisMs = plan.exists ? getMilestones(plan, from) : undefined;
  const nextFrom = addDays(from, 7);
  const nextMs = plan.exists ? getMilestones(plan, nextFrom) : undefined;
  const msBlock = (title: string, ms: typeof thisMs) => {
    if (!ms) {
      L.push(`${title}: không có trong MASTER_ROADMAP.`);
      return;
    }
    L.push(`${title} (${fmtDM(ms.from)}-${fmtDM(ms.to)}):`);
    for (const [k, text] of Object.entries(ms.bySubject)) L.push(`- ${subjectName(model, k)}: ${text}`);
  };
  msBlock("Mốc tuần này", thisMs);
  msBlock("Mốc tuần sau", nextMs);
  L.push("Chọn 3 việc quan trọng nhất cho tuần tới.");
  L.push("");

  /* 9. Source notes */
  const notes = [...ev.notes, ...plan.warnings, ...model.warnings];
  if (journal.invalid > 0) notes.push(`${journal.invalid} dòng journal không hợp lệ đã bị bỏ qua.`);
  L.push("## Ghi chú nguồn dữ liệu");
  if (notes.length === 0) L.push("- Không có ghi chú.");
  for (const n of notes) L.push(`- ${n}`);
  L.push("");

  /* Shareable summary: at most 5 plain lines, no personal file paths */
  const share: string[] = [];
  share.push(
    budget
      ? `Giờ học: ${fmtHours(studyMin / 60)} giờ so với ngân sách ${fmtRange(budget.total)} giờ.`
      : `Giờ học: ${fmtHours(studyMin / 60)} giờ (chưa có ngân sách giờ cho tuần này).`,
  );
  share.push(`Số ngày có học: ${studyDays}/7.`);
  const nCommits = tally.kept + tally.late + tally.missed + tally.pending;
  share.push(nCommits > 0 ? `Cam kết giữ đúng hẹn: ${tally.kept}/${nCommits}.` : "Cam kết: tuần này chưa đặt cam kết nào.");
  const nowMs = ctx.now.getTime();
  const missed = dueAll
    .filter((t) => !t.checked && t.deadline && Date.parse(`${t.deadline.slice(0, 10)}T${t.deadline.slice(11)}:00`) < nowMs)
    .sort((a, b) => (a.priority ?? "P9").localeCompare(b.priority ?? "P9") || (a.deadline as string).localeCompare(b.deadline as string));
  const top = missed[0];
  if (top) {
    share.push(
      `Hạn lỡ nổi bật: ${truncate(scrubPaths(plainText(top.text)), 90)} (${subjectName(model, top.subject)}, hạn ${(top.deadline as string).slice(0, 10)}).`,
    );
  }
  share.push("Tuần tới: 3 việc quan trọng nhất: ...(tự điền)");
  L.push("## Bản tóm tắt để chia sẻ");
  for (const line of share.slice(0, 5)) L.push(line);

  const markdown = L.join("\n");
  const filePath = `${ctx.hub}/Roadmaps/weekly_reviews/${iso.year}-W${pad2(iso.week)}.md`;
  return {
    label: iso.label,
    from,
    to,
    markdown,
    filePath,
    data: {
      week: { label: iso.label, from, to },
      summary: {
        studyMinutes: studyMin,
        metaMinutes: metaMin,
        studyDays,
        budgetHours: budget ? { phase: budget.phase.id, total: budget.total } : null,
        commitments: tally,
        capacity: { weeksUsed: cap.used, medianHours: cap.median ?? null, weeks: cap.weeks, enough: cap.enough, lines: capLines },
      },
      subjects: rows,
      days: dayRows,
      estimates: est,
      deadlines: {
        dueInWeek: { done: dueDone, total: dueAll.length },
        overdueUntriaged: dl.buckets.overdue.length,
        principle7,
      },
      infrastructure: {
        metaMinutes: metaMin,
        studyMinutes: studyMin,
        subjectCommits: subjCommits,
        toolingCommits: toolCommits,
        toolHeavy,
        studyEvidence: studyTot,
      },
      evidence: ev,
      notes,
      shareSummary: share.slice(0, 5),
    },
  };
}

export async function runWeek(a: { hub?: string; now?: string; week?: string; write?: boolean }): Promise<OpResult> {
  const ctx = await loadCtx(a);
  const weekDate = a.week?.trim() || ctx.today;
  if (!isValidDateStr(weekDate)) throw new Error(`week không hợp lệ: "${weekDate}" (cần một ngày YYYY-MM-DD trong tuần).`);
  const from = weekStartOf(weekDate);
  const journal = await readJournal(ctx.hub);
  const plan = await loadPlan(ctx.hub, ctx.model.subjects, ctx.now);
  const ev = await collectEvidence(ctx.model, { from, to: addDays(from, 6) });
  const dl = computeDeadlines(ctx, journal);
  const rep = await buildWeek(ctx, journal, plan, ev, dl, weekDate);

  let text = rep.markdown;
  let smartDrive = false;
  let written: string | undefined;
  if (a.write === true) {
    await atomicWriteFile(rep.filePath, rep.markdown + "\n");
    written = rep.filePath;
    // Post-write hook: ask SmartDrive to refresh its index for the review folder (never for .sirius/).
    smartDrive = notifySmartDrive(`${ctx.hub}/Roadmaps/weekly_reviews`);
    text += `\n\nĐã ghi bản tổng kết tuần vào: ${rep.filePath}${smartDrive ? " (đã báo SmartDrive cập nhật chỉ mục)" : ""}`;
  }
  return { text, data: { ...rep.data, written: written ?? null, smartDriveNotified: smartDrive } };
}

/* ───────── Stats ───────── */

export async function runStats(a: { hub?: string; now?: string; weeks?: number }): Promise<OpResult> {
  const ctx = await loadCtx(a);
  const n = Math.min(26, Math.max(1, Number.isFinite(a.weeks) ? Math.floor(a.weeks as number) : 4));
  const journal = await readJournal(ctx.hub);
  const plan = await loadPlan(ctx.hub, ctx.model.subjects, ctx.now);
  const curStart = weekStartOf(ctx.today);
  // Rigel activity (read-only, optional): read once, counted per week below.
  const studySrc = await loadStudyEvents();

  const L: string[] = [];
  L.push(`# Thống kê (${ctx.today}, ${viWeekday(ctx.today)})`);
  L.push("");
  L.push(`## Theo tuần (${n} tuần gần nhất)`);
  L.push("| Tuần | Học (phút) | Theo khóa (phút) | Meta (phút) | Ngày học |");
  L.push("| :--- | ---: | :--- | ---: | ---: |");
  const weekRows: Record<string, unknown>[] = [];
  const studyRows: { label: string; from: string; to: string; study: StudyStats }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const ws = addDays(curStart, -7 * i);
    const we = addDays(ws, 6);
    const mine = journal.sessions.filter((s) => {
      const d = sessionDate(s);
      return d >= ws && d <= we;
    });
    const st = mine.filter((s) => s.kind !== "meta");
    const per = new Map<string, number>();
    for (const s of st) per.set(s.subject, (per.get(s.subject) ?? 0) + s.minutes);
    const metaMin = sumMinutes(mine.filter((s) => s.kind === "meta"));
    const days = new Set(st.map(sessionDate)).size;
    const label = isoWeekOf(ws).label;
    L.push(
      `| ${label} (${fmtDM(ws)}-${fmtDM(we)}) | ${sumMinutes(st)} | ${per.size > 0 ? cell([...per.entries()].map(([k, m]) => `${subjectName(ctx.model, k)} ${m}`).join("; ")) : "-"} | ${metaMin} | ${days} |`,
    );
    const study = studyTotal(tallyStudy(studySrc.data, { from: ws, to: we }, ctx.model.subjects).data);
    studyRows.push({ label, from: ws, to: we, study });
    weekRows.push({
      label,
      from: ws,
      to: we,
      studyMinutes: sumMinutes(st),
      bySubject: Object.fromEntries(per),
      metaMinutes: metaMin,
      studyDays: days,
      study,
    });
  }
  L.push("");

  // Optional section: only when Rigel left activity inside these weeks.
  if (studyRows.some((r) => studyActive(r.study))) {
    L.push("## Hỏi đáp có nguồn theo tuần (Rigel)");
    L.push("| Tuần | Hỏi đáp có nguồn | Thẻ từ tài liệu |");
    L.push("| :--- | :--- | ---: |");
    for (const r of studyRows) {
      const q = r.study.questions > 0 ? `${r.study.questions} (${studyCoverageText(r.study)})` : "0";
      L.push(`| ${r.label} (${fmtDM(r.from)}-${fmtDM(r.to)}) | ${q} | ${r.study.cards} |`);
    }
    L.push("");
  }

  const streak = computeStreak(journal.sessions, ctx.today);
  L.push("## Chuỗi ngày học");
  L.push(
    streak.streak > 0
      ? `- Chuỗi (cho phép bỏ 1 ngày lẻ): ${streak.streak} ngày học trong ${streak.spanDays} ngày liên tục${streak.todayCounts ? "" : " (hôm nay chưa có phiên đủ 10 phút)"}.`
      : "- Chuỗi (cho phép bỏ 1 ngày lẻ): 0 ngày. Hai ngày trống liên tiếp làm chuỗi đứt; một phiên học đủ 10 phút hôm nay bắt đầu chuỗi mới.",
  );
  L.push(`- Số ngày học trong 14 ngày qua: ${streak.last14}/14`);
  L.push("");

  const cap = computeCapacity(journal.sessions, curStart);
  const budget = plan.exists ? getWeekBudget(plan, curStart) : undefined;
  const capLines = capacityLines(cap, budget?.total.min);
  L.push("## Năng lực thực tế");
  for (const line of capLines) L.push(`- ${line}`);
  L.push("");

  const est = computeEstimates(journal.sessions);
  L.push("## Ước lượng thời gian (toàn bộ lịch sử)");
  for (const line of estimateLines(ctx, est)) L.push(`- ${line}`);
  L.push("");

  const tally = tallyCommits(journal, ctx.now);
  const denom = tally.kept + tally.late + tally.missed;
  const keepRate = denom > 0 ? tally.kept / denom : null;
  L.push("## Cam kết");
  L.push(
    keepRate === null
      ? `- Chưa có cam kết nào đã đến hạn xét (đúng hẹn ${tally.kept}, trễ ${tally.late}, bỏ lỡ ${tally.missed}, chưa tới giờ ${tally.pending}).`
      : `- Tỉ lệ giữ cam kết: ${Math.round(keepRate * 100)}% (đúng hẹn ${tally.kept}, trễ ${tally.late}, bỏ lỡ ${tally.missed}; chưa tới giờ ${tally.pending}).`,
  );
  if (journal.invalid > 0) {
    L.push("");
    L.push(`Ghi chú: ${journal.invalid} dòng journal không hợp lệ đã bị bỏ qua.`);
  }
  for (const note of studySrc.notes) {
    L.push("");
    L.push(`Ghi chú: ${note}`);
  }

  return {
    text: L.join("\n"),
    data: {
      today: ctx.today,
      weeks: weekRows,
      streak,
      capacity: { weeksUsed: cap.used, medianHours: cap.median ?? null, weeks: cap.weeks, enough: cap.enough, lines: capLines },
      estimateRatio: est,
      commitments: { ...tally, keepRate },
      invalidJournalLines: journal.invalid,
      notes: studySrc.notes,
    },
  };
}
