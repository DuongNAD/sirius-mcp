import { existsSync } from "node:fs";
import { computeDeadlines, renderRow, type DeadlineItem } from "./deadlines.js";
import {
  findFailingLab,
  hasPolarisSchedule,
  loadLabs,
  readPolarisDue,
  readVegaDue,
  type LabInfo,
  type PolarisDueStep,
  type VegaDue,
} from "./evidence.js";
import { loadCtx, subjectName, type Ctx, type Subject } from "./hub.js";
import {
  COMMIT_STATUS_LABEL,
  KIND_LABEL,
  commitStatus,
  dailyMinimum,
  dayTotals,
  readActive,
  readJournal,
  type JournalData,
} from "./journal.js";
import {
  getDayPlan,
  getMilestones,
  loadPlan,
  type MinutesRange,
  type Plan,
  type PlanSession,
} from "./plan.js";
import type { OpResult, SessionRecord } from "./schema.js";
import {
  fmtDM,
  isValidDateStr,
  localTimeStr,
  plainText,
  truncate,
  viWeekday,
} from "./util.js";

export interface NextStep {
  kind: "polaris_today" | "vega" | "orion_run" | "next_action";
  text: string;
}

function minutesText(m: MinutesRange | null): string {
  if (!m) return "không rõ số phút";
  return m.min === m.max ? `${m.min} phút` : `${m.min}-${m.max} phút`;
}

function sessionName(s: PlanSession, ctx: Ctx): string {
  if (s.subject) return subjectName(ctx.model, s.subject);
  if (s.alternatives) return s.alternatives.map((k) => subjectName(ctx.model, k)).join(" hoặc ");
  if (s.kind === "review") return "Ôn xuyên khóa";
  if (s.kind === "rest") return "Nghỉ";
  if (s.kind === "buffer") return "Dự phòng";
  return (s.label.split(/[,:(]/)[0] ?? s.label).trim() || s.label;
}

function sessionLine(tag: string, s: PlanSession, ctx: Ctx): string {
  const unresolved = !s.subject && !s.alternatives && s.kind !== "review" && s.kind !== "rest" && s.kind !== "buffer";
  const mins = s.kind === "rest" ? "" : `, ${minutesText(s.minutes)}`;
  return `- ${tag}: ${sessionName(s, ctx)}${mins} (mẫu: "${s.label}")${unresolved ? "; chưa nhận ra khóa này trong ACTIVE_LEARNING.md" : ""}`;
}

/** Subject keys involved in a day's template, in order of appearance. */
function involvedSubjects(sessions: PlanSession[]): string[] {
  const out: string[] = [];
  for (const s of sessions) {
    if (s.subject && !out.includes(s.subject)) out.push(s.subject);
    for (const k of s.alternatives ?? []) if (!out.includes(k)) out.push(k);
  }
  return out;
}

/**
 * One "Bước tiếp theo" per subject: (a) polaris_today when polaris/schedule.json exists, (b) vega_sync then
 * vega_session when that subject has due cards, (c) orion_run for a lab whose latest attempt did not pass,
 * (d) otherwise the project's Next Action. Read-only checks; missing files are skipped.
 */
export function chooseNextStep(
  subject: Subject,
  vega: VegaDue,
  labs: LabInfo[] | undefined,
): NextStep | "needs-labs" {
  if (hasPolarisSchedule(subject.dir)) {
    return {
      kind: "polaris_today",
      text: `polaris_today { subject_dir: "${subject.dir}" } (kế hoạch bài học chi tiết)`,
    };
  }
  const due = vega.bySubject[subject.key] ?? 0;
  if (due > 0) return { kind: "vega", text: `vega_sync, rồi vega_session (${due} thẻ đến hạn)` };
  if (labs === undefined) return "needs-labs";
  const lab = findFailingLab(labs, subject.key);
  if (lab) return { kind: "orion_run", text: `orion_run { lab: "${lab.dir}" } (lần chạy gần nhất chưa qua hết test)` };
  return {
    kind: "next_action",
    text: subject.nextAction ? plainText(subject.nextAction) : "chưa có Next Action trong ACTIVE_LEARNING.md",
  };
}

export async function computeNextSteps(
  ctx: Ctx,
  keys: string[],
  vega: VegaDue,
): Promise<Record<string, NextStep>> {
  const out: Record<string, NextStep> = {};
  const pending: Subject[] = [];
  for (const key of keys) {
    const s = ctx.model.subjects.find((x) => x.key === key);
    if (!s) continue;
    const r = chooseNextStep(s, vega, undefined);
    if (r === "needs-labs") pending.push(s);
    else out[key] = r;
  }
  if (pending.length > 0) {
    const labs = (await loadLabs(ctx.model)).data;
    for (const s of pending) {
      const r = chooseNextStep(s, vega, labs);
      if (r !== "needs-labs") out[s.key] = r;
    }
  }
  return out;
}

export async function runToday(a: { hub?: string; now?: string; date?: string }): Promise<OpResult> {
  const ctx = await loadCtx(a);
  const date = a.date?.trim() || ctx.today;
  if (!isValidDateStr(date)) throw new Error(`date không hợp lệ: "${date}" (cần YYYY-MM-DD).`);
  const journal: JournalData = await readJournal(ctx.hub);
  const dl = computeDeadlines(ctx, journal);
  const plan: Plan = await loadPlan(ctx.hub, ctx.model.subjects, ctx.now);
  const L: string[] = [];
  L.push(`# Hôm nay (${date}, ${viWeekday(date)})`);

  /* 1. Deadline priorities come first */
  const b = dl.buckets;
  const priorityItems: DeadlineItem[] = [
    ...b.overdue.filter((i) => i.priority === "P0"),
    ...b.urgent,
    ...b.h48.filter((i) => i.priority === "P0"),
    ...b.h72.filter((i) => i.priority === "P0"),
  ];
  const otherOverdue = b.overdue.filter((i) => i.priority !== "P0");
  L.push("");
  if (priorityItems.length > 0) {
    L.push("## Ưu tiên hạn chót");
    L.push("Các việc dưới đây đứng trước tuần mẫu của ngày. Làm hoặc chặn lịch cho chúng trước.");
    for (const it of priorityItems.slice(0, 10)) L.push(renderRow(it, it.remainingMs < 0 ? "overdue" : "upcoming"));
    if (priorityItems.length > 10) L.push(`... còn ${priorityItems.length - 10} mục nữa (xem sirius_deadlines).`);
    if (otherOverdue.length > 0) {
      L.push(
        `Ngoài ra còn ${otherOverdue.length} mục quá hạn chưa phân loại (không phải P0): chạy sirius_triage { action: "suggest" }.`,
      );
    }
    L.push("");
  } else if (b.overdue.length > 0) {
    L.push(
      `Ghi chú: còn ${b.overdue.length} mục quá hạn chưa phân loại (không có P0): chạy sirius_triage { action: "suggest" }.`,
    );
    L.push("");
  }

  /* 2. Weekly template */
  const dp = plan.exists ? getDayPlan(plan, date) : undefined;
  const involved: string[] = [];
  const nextSteps: Record<string, NextStep> = {};
  let vegaDue: VegaDue = { exists: false, total: 0, bySubject: {} };
  vegaDue = await readVegaDue(ctx.hub, date, ctx.model.subjects);
  if (dp) {
    L.push(`## Lịch theo tuần mẫu (Giai đoạn ${dp.phase.id}, ${viWeekday(date)})`);
    const day = dp.day;
    if (!day || (day.main.length === 0 && day.extra.length === 0)) {
      L.push("Không có buổi nào trong tuần mẫu cho ngày này.");
    } else {
      for (const s of day.main) L.push(sessionLine("Chính", s, ctx));
      for (const s of day.extra) L.push(sessionLine("Phụ", s, ctx));
      involved.push(...involvedSubjects([...day.main, ...day.extra]));
      Object.assign(nextSteps, await computeNextSteps(ctx, involved, vegaDue));
      const ms = getMilestones(plan, date);
      for (const key of involved) {
        const s = ctx.model.subjects.find((x) => x.key === key);
        if (!s) continue;
        L.push("");
        L.push(`### ${s.name}`);
        const milestone = ms?.bySubject[key];
        if (milestone) L.push(`- Mốc tuần ${fmtDM(ms!.from)}-${fmtDM(ms!.to)}: ${milestone}`);
        const step = nextSteps[key];
        if (s.nextAction && step?.kind !== "next_action") {
          L.push(`- Việc kế tiếp (ACTIVE_LEARNING): ${truncate(plainText(s.nextAction), 220)}`);
        }
        if (step) L.push(`- Bước tiếp theo: ${truncate(step.text, 260)}`);
      }
    }
    L.push("");
  } else if (!plan.exists) {
    L.push("## Lịch theo tuần mẫu");
    L.push("Không tìm thấy Roadmaps/MASTER_ROADMAP.md: chưa có tuần mẫu. Dùng ACTIVE_LEARNING.md để chọn việc.");
    L.push("");
  } else {
    const first = plan.phases[0]?.start;
    L.push("## Lịch theo tuần mẫu");
    L.push(
      `Ngày ${date} nằm ngoài các giai đoạn của MASTER_ROADMAP${first ? ` (giai đoạn đầu bắt đầu ${first})` : ""}. Dùng ACTIVE_LEARNING.md để chọn việc.`,
    );
    L.push("");
  }

  /* 3. Reviews due (Vega cards and Polaris review steps); missing files are omitted silently */
  const polarisDue: PolarisDueStep[] = await readPolarisDue(ctx.model, date);
  const hasPolarisFiles = ctx.model.subjects.some((s) => existsSync(`${s.dir}/polaris/reviews.json`));
  if (vegaDue.exists || hasPolarisFiles) {
    L.push("## Ôn tập đến hạn");
    if (vegaDue.exists) {
      const per = Object.entries(vegaDue.bySubject)
        .map(([k, n]) => `${k === "?" ? "không rõ khóa" : subjectName(ctx.model, k)} ${n}`)
        .join(", ");
      L.push(
        vegaDue.total > 0
          ? `- Vega: ${vegaDue.total} thẻ đến hạn trong ngày ${date}${per ? ` (${per})` : ""}. Bước: vega_sync, rồi vega_session.`
          : "- Vega: 0 thẻ đến hạn.",
      );
    }
    if (hasPolarisFiles) {
      if (polarisDue.length === 0) L.push("- Polaris: 0 bước ôn đến hạn.");
      for (const st of polarisDue.slice(0, 10)) {
        L.push(`- Polaris (${subjectName(ctx.model, st.subject)}): ${truncate(plainText(st.title), 90)} (hạn ${st.dueDate})`);
      }
      if (polarisDue.length > 10) L.push(`... còn ${polarisDue.length - 10} bước nữa.`);
    }
    L.push("");
  }

  /* 4. Commitments (a running timer counts as a session that has started) */
  const active = await readActive(ctx.hub);
  const sessionsForStatus: SessionRecord[] = [...journal.sessions];
  if (active) {
    sessionsForStatus.push({
      v: 1,
      type: "session",
      at: active.start,
      id: active.id,
      subject: active.subject,
      kind: active.kind,
      start: active.start,
      end: active.start,
      minutes: 1,
      outcome: "partial",
      source: "timer",
      ...(active.commitId ? { commitId: active.commitId } : {}),
    });
  }
  const commits = journal.commits.filter((c) => c.date === date).sort((x, y) => x.time.localeCompare(y.time));
  L.push("## Cam kết hôm nay");
  const commitRows: { id: string; time: string; status: string }[] = [];
  if (commits.length === 0) {
    L.push("Chưa có cam kết nào. Mẫu: Khi <giờ> ở <nơi>, mình sẽ <bước đầu tiên cụ thể> trong <N> phút. -> sirius_commit");
  } else {
    for (const c of commits) {
      const st = COMMIT_STATUS_LABEL[commitStatus(c, sessionsForStatus, ctx.now)];
      commitRows.push({ id: c.id, time: c.time, status: st });
      L.push(
        `- ${c.time} ${subjectName(ctx.model, c.subject)}, ${c.minutes} phút: ${c.action}${c.where ? ` (ở ${c.where})` : ""} [${st}] (${c.id})`,
      );
    }
  }
  L.push("");

  /* 5. Running timer */
  if (active) {
    const elapsed = Math.max(0, Math.round((ctx.now.getTime() - Date.parse(active.start)) / 60000));
    L.push("## Đang chạy");
    L.push(
      `- ${subjectName(ctx.model, active.subject)} (${KIND_LABEL[active.kind]}), bắt đầu ${localTimeStr(new Date(active.start))}, đã ${elapsed} phút / ước lượng ${active.estimate} phút (${active.id}). Xong thì gọi sirius_stop.`,
    );
    L.push("");
  }

  /* 6. Learned today */
  const totals = dayTotals(journal.sessions, date);
  L.push("## Hôm nay đã học");
  if (totals.count === 0) {
    L.push("Chưa có phiên nào được ghi cho ngày này.");
  } else {
    L.push(`- Tổng: ${totals.study} phút học, ${totals.meta} phút meta (${totals.count} phiên).`);
    const bySubject = Object.entries(totals.bySubject)
      .map(([k, n]) => `${subjectName(ctx.model, k)} ${n}`)
      .join("; ");
    const byKind = Object.entries(totals.byKind)
      .map(([k, n]) => `${KIND_LABEL[k as keyof typeof KIND_LABEL] ?? k} ${n}`)
      .join("; ");
    L.push(`- Theo khóa (phút): ${bySubject}`);
    L.push(`- Theo loại (phút): ${byKind}`);
  }
  const dailyMin = dailyMinimum();
  const lack = dailyMin - totals.study;
  L.push(
    lack <= 0
      ? `- Mức tối thiểu hằng ngày: ${dailyMin} phút (đã đạt)`
      : `- Mức tối thiểu hằng ngày: ${dailyMin} phút (${date < ctx.today ? 'thiếu' : 'còn'} ${lack} phút)`,
  );

  /* Notes: plan warnings and read warnings */
  const notes = [...plan.warnings, ...dl.warnings];
  if (notes.length > 0) {
    L.push("");
    L.push("## Ghi chú");
    for (const n of notes.slice(0, 8)) L.push(`- ${n}`);
    if (notes.length > 8) L.push(`- ... còn ${notes.length - 8} ghi chú nữa.`);
  }

  return {
    text: L.join("\n"),
    data: {
      date,
      weekday: viWeekday(date),
      priority: priorityItems,
      phase: dp?.phase.id ?? null,
      template: dp?.day ?? null,
      involved,
      nextSteps,
      reviews: { vega: vegaDue, polaris: polarisDue },
      commitments: commits.map((c) => ({
        ...c,
        status: commitRows.find((r) => r.id === c.id)?.status,
      })),
      active: active ?? null,
      today: totals,
      warnings: plan.warnings,
    },
  };
}
