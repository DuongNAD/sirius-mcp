#!/usr/bin/env node
/**
 * End-to-end test over real MCP stdio for Sirius MCP.
 *
 * Builds a fake learning hub under %TEMP% (boards with every tricky case, MASTER_ROADMAP.md, Vega, Polaris,
 * Orion, Aurora and Mira evidence, a Rigel activity.jsonl, two git repos) and exercises all 10 tools, the
 * CLI, the journal, the derived triage.json, the privacy .gitignore, the SmartDrive post-write hook, and the
 * invariants that Sirius never edits learner files and never writes into the Rigel folder. Nothing is
 * written outside %TEMP%.
 *
 *   node scripts/e2e.mjs
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const base =
  process.platform === "win32"
    ? join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "aurora-slides")
    : join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "aurora-slides");

const TOOL = resolve(
  process.env.SIRIUS_TOOLCHAIN ??
    process.env.ORION_TOOLCHAIN ??
    process.env.VEGA_TOOLCHAIN ??
    process.env.POLARIS_TOOLCHAIN ??
    join(base, "toolchain"),
);
const req = createRequire(join(TOOL, "package.json"));
const { Client } = req("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = req("@modelcontextprotocol/sdk/client/stdio.js");

const DIST = join(ROOT, "dist", "sirius.mjs");
const lib = await import(pathToFileURL(DIST).href);

/* ───────── Tiny harness ───────── */

let failed = 0;
let passed = 0;
const ok = (name, cond, detail = "") => {
  if (!cond) failed++;
  else passed++;
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${detail ? `  (${String(detail).slice(0, 400)})` : ""}`);
};
const textOf = (r) =>
  (r.content ?? [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
const section = (t) => console.log(`\n--- ${t} ---`);
const ALL_OUT = [];
const collect = (s) => {
  ALL_OUT.push(s);
  return s;
};

/* ───────── Time helpers (machine local time, like the server) ───────── */

const pad = (n) => String(n).padStart(2, "0");
const local = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi, 0);
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const dlStr = (d) => `${ymd(d)} ${hm(d)}`;
const isoLocal = (d) => {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const a = Math.abs(off);
  return `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
};
const NOW = local(2026, 10, 12, 0, 47); // Monday 2026-10-12 00:47
const NOW_ISO = isoLocal(NOW);
const H = 3600000;
const at = (ms) => new Date(NOW.getTime() + ms);
const T = (d, h, m) => isoLocal(local(2026, 10, d, h, m));
const fmtVi1 = (x) => x.toFixed(1).replace(".", ",");

/* ───────── Fixture hub under %TEMP% ───────── */

const TEST_DIR = join(tmpdir(), `sirius_e2e_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
rmSync(TEST_DIR, { recursive: true, force: true });
mkdirSync(TEST_DIR, { recursive: true });
const HUB = join(TEST_DIR, "hub");
const GCI = join(HUB, "GCI_World_2026_September");
const ML = join(HUB, "Machine_Learning");
const PM = join(HUB, "Python_Master");
const url = (p) => `file:///${p.replace(/\\/g, "/")}`;
const fwdp = (p) => p.replace(/\\/g, "/");
const put = (p, content) => {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content, "utf8");
};
const lineNo = (lines, needle) => {
  const i = lines.findIndex((l) => l.includes(needle));
  if (i < 0) throw new Error(`fixture line not found: ${needle}`);
  return i + 1;
};

const D_5H = at(5 * H);
const D_30H = at(30 * H);
const D_60H = at(60 * H);
const D_10D = at(10 * 24 * H);

// Task lines (exact text as written in the fixture files)
const ML_V1_TEXT = `Cài đặt thuật toán Ridge và Lasso Regularization, phân tích hiện tượng Co-efficient Shrinkage trong [01_Regression](${url(ML)}/02_Supervised_Learning/01_Regression).`;
const ML_V1_LINE = `- [ ] [Deadline: 2026-09-26 23:59] [Priority: P1] ${ML_V1_TEXT}`;
const WATCH_ML_V1_LINE = `- [ ] [Deadline: 2026-09-26 23:59] [Priority: P1] Machine Learning: ${ML_V1_TEXT}`;
const ML_KNN_LINE = "- [ ] [Deadline: 2026-09-28 23:59] [Priority: P2] Triển khai thuật toán K-Nearest Neighbors (KNN) từ scratch và so sánh với Scikit-learn.";
const ML_NEW_LINE = "- [ ] [Deadline: 2026-11-15 21:00] [Priority: P1] M3.3a: Ridge/Lasso coefficient path, chọn alpha bằng CV trên StudentScore (thay task Ridge/Lasso hạn 2026-09-26).";
const ML_NOTAG_LINE = "- [ ] Ghi chú ý tưởng chưa có thẻ nào.";
const SURVEY4_LINE = `- [ ] [Deadline: ${dlStr(D_30H)}] [Priority: P0] Nộp Attendance Survey Buổi 4 trên Omnicampus.`;
const GCI_HW4_LINE = "- [ ] [Deadline: 2026-10-20 18:00] [Priority: P0] Nộp Homework `HW4` trên Omnicampus.";
const WATCH_HW4_LINE = "- [ ] [Deadline: 2026-10-20 18:00] [Priority: P0] GCI World: Nộp Homework HW4 trên Omnicampus.";
const GCI_NOPRIO_LINE = "- [ ] [Deadline: 2026-10-30 18:00] Nhiệm vụ thiếu Priority để kiểm tra lệch định dạng.";
const SURVEY1_A = "- [x] [Deadline: 2026-10-08 18:00] [Priority: P0] Làm Khảo sát điểm danh Buổi 1 (Attendance Survey) trên Omnicampus (Status: OK).";
const SURVEY1_B = "- [x] [Deadline: 2026-10-08 11:00] [Priority: P0] Khảo sát điểm danh Buổi 1 (Attendance Survey) trên OmniCampus (Status: Hoàn thành).";
const SURVEY2 = "- [x] [Deadline: 2026-10-09 08:00] [Priority: P0] Khảo sát điểm danh Buổi 2 (Attendance Survey) trên OmniCampus (Status: Hoàn thành OK).";
const GCI_CHECKED_OLD = "- [x] [Deadline: 2026-09-20 23:59] [Priority: P1] Task đã xong từ lâu, phải bị bỏ qua.";
const GCI_FENCED = "- [ ] [Deadline: 2026-09-01 23:59] [Priority: P0] Task nằm trong khối mã, phải bị bỏ qua.";
const PM_5H_LINE = `- [ ] [Deadline: ${dlStr(D_5H)}] [Priority: P2] Nộp bài Python hôm nay vào sổ theo dõi.`;
const PM_60H_LINE = `- [ ] [Deadline: ${dlStr(D_60H)}] [Priority: P1] Hoàn thành chuyên đề Ma trận và Mảng 2 chiều.`;
const PM_10D_LINE = `- [ ] [Deadline: ${dlStr(D_10D)}] [Priority: P2] Ôn xen kẽ X1 từ 80%.`;
const PM_OLD_LINE = "- [ ] [Deadline: 2026-09-27 23:59] [Priority: P1] Hoàn thành chuyên đề Chuỗi và Mảng 1 chiều.";
const PM_FILLERS = Array.from({ length: 8 }, (_, i) => `- [ ] [Deadline: 2026-10-0${i + 1} 20:00] [Priority: P2] Giải bài luyện tập số ${i + 1} trong kho luyen_tap.`);
const CENTRAL_OLD_LINE = "- [ ] [Deadline: 2026-09-25 18:00] [Priority: P1] Thiết lập kiểm tra tự động tính toàn vẹn liên kết nội bộ (file:/// link validator script).";
const CENTRAL_NEW_LINE = "- [ ] [Deadline: 2026-10-05 18:00] [Priority: P2] Rà soát định kỳ trạng thái đồng bộ git và dung lượng lưu trữ.";

const alLines = [
  "---",
  "document_type: active_learning_hub",
  "version: 2.1.0",
  "---",
  "",
  "# Active Learning Hub & Focus Board",
  "",
  "## Today's Dynamic Goal",
  "- Date: 2026-10-11",
  "- Subject: Python Master",
  "- Target: Giải 1 bài Python mỗi ngày trong kho luyen_tap.",
  "- Definition of Done (DoD): 1 bài PASS và ghi vào sổ theo dõi.",
  "- Status: In Progress",
  "- Deadline: 2026-10-17 23:59",
  "- Priority: P2",
  "",
  "## Active Priority Watchlist & Deadlines",
  "- [x] [Deadline: 2026-09-24 19:00] [Priority: P0] GCI World: Chuẩn bị nội dung Buổi 2: Xử lý dữ liệu với NumPy.",
  WATCH_ML_V1_LINE,
  WATCH_HW4_LINE,
  "",
  "## Active Projects",
  "",
  "### 1. GCI World 2026",
  `- Directory: [GCI_World_2026_September](${url(GCI)})`,
  `- Tasks: [TASKS.md](${url(GCI)}/TASKS.md)`,
  `- Roadmap: [ROADMAP.md](${url(GCI)}/roadmap/ROADMAP.md)`,
  "- Milestone: Phân tích dữ liệu khám phá.",
  "- Checkpoint: HW3 đạt 3.0/3.0.",
  "- Next Action: Hoàn thành Attendance Survey Buổi 4 trên Omnicampus.",
  `- Deadline: ${dlStr(D_30H)}`,
  "- Priority: P0",
  "",
  "### 2. Machine Learning",
  `- Directory: [Machine_Learning](${url(ML)})`,
  `- Tasks: [TASKS.md](${url(ML)}/TASKS.md)`,
  `- Roadmap: [ROADMAP.md](${url(ML)}/Roadmaps/ROADMAP.md)`,
  "- Milestone: Hồi quy tuyến tính tự cài.",
  "- Checkpoint: Lộ trình v2.",
  "- Next Action: M1 + M2.1: tự cài hồi quy tuyến tính bằng normal equation.",
  "- Deadline: 2026-10-18 21:00",
  "- Priority: P1",
  "",
  "### 3. Python Master",
  `- Directory: [Python_Master](${url(PM)})`,
  `- Tasks: [TASKS.md](${url(PM)}/TASKS.md)`,
  `- Roadmap: [ROADMAP.md](${url(PM)}/Roadmaps/ROADMAP.md)`,
  "- Milestone: Duy trì vi mô.",
  "- Checkpoint: Chuyển sang luyện 1 bài mỗi ngày.",
  "- Next Action: Mỗi ngày giải 1 bài trong kho luyen_tap.",
  `- Deadline: ${dlStr(D_5H)}`,
  "- Priority: P2",
  "",
  "## Backlog",
  "- [React](file:///D:/02_Learning_Knowledge/React): Frontend.",
  "",
];

const centralLines = [
  "---",
  "document_type: system_task_board",
  "---",
  "",
  "# Workspace System Task Board & Subproject Router",
  "",
  "## Project Task Board Router (Active Projects)",
  "",
  "| Active Subject | Project Directory | Local Task Board |",
  "| :--- | :--- | :--- |",
  `| 1. GCI World 2026 September | [GCI_World_2026_September](${url(GCI)}) | [TASKS.md](${url(GCI)}/TASKS.md) |`,
  `| 2. Machine Learning | [Machine_Learning](${url(ML)}) | [TASKS.md](${url(ML)}/TASKS.md) |`,
  `| 3. Python Master | [Python_Master](${url(PM)}) | [TASKS.md](${url(PM)}/TASKS.md) |`,
  "",
  "## Workspace Infrastructure & Cross-Cutting Tasks",
  "",
  "### In Progress",
  CENTRAL_OLD_LINE,
  CENTRAL_NEW_LINE,
  "",
  "### Completed",
  "- [x] [Deadline: 2026-09-22 23:59] [Priority: P1] Thiết lập kiến trúc Master Knowledge Map.",
  "",
];

const gciLines = [
  "---",
  "document_type: project_task_board",
  "---",
  "",
  "# GCI World 2026 September - Task Board",
  "",
  "## 1. Setup & Onboarding",
  SURVEY1_A,
  GCI_CHECKED_OLD,
  "",
  "## 2. Coursework",
  SURVEY4_LINE,
  GCI_HW4_LINE,
  GCI_NOPRIO_LINE,
  "",
  "## 7. Logistics",
  SURVEY1_B,
  SURVEY2,
  "",
  "## Ghi chú",
  "```text",
  GCI_FENCED,
  "```",
  "",
];

const mlLines = [
  "# Machine Learning - Task Board",
  "",
  "## 1. Supervised Learning Algorithms",
  ML_V1_LINE,
  ML_KNN_LINE,
  ML_NOTAG_LINE,
  "",
  "## 4. Roadmap v2 Milestones",
  ML_NEW_LINE,
  "- [x] [Deadline: 2026-09-21 23:59] [Priority: P2] Thiết lập bài toán Linear Regression (đã xong, bị bỏ qua).",
  "- [x] [Deadline: 2026-10-14 18:00] [Priority: P2] Đọc xong chương hồi quy tuyến tính (đã xong trong tuần).",
  "",
];

const pmLines = [
  "# Python Master - Task Board",
  "",
  "## 2. Practice",
  PM_5H_LINE,
  PM_60H_LINE,
  PM_10D_LINE,
  PM_OLD_LINE,
  ...PM_FILLERS,
  "",
];

const planMd = `# Lộ trình tổng 4 khóa (cập nhật 2026-10-10)

> Fixture chép cấu trúc từ lộ trình thật.

## 1. Bốn khóa và vai trò

| Khóa | Ưu tiên | Vai trò |
| :--- | :--- | :--- |
| GCI World 2026 September | P0 | Khóa có hạn chót thật |

## 3. Ngân sách thời gian theo giai đoạn

Giả định bạn có khoảng 14-16 giờ/tuần.

| Giai đoạn | GCI | Machine Learning | Python Master | AMD | Tổng |
| :--- | :--- | :--- | :--- | :--- | :--- |
| I. 12/10-25/10 (GCI Buổi 5-6) | 5-6,5 giờ | 3 giờ | 2,5-3 giờ | 1-2 giờ | khoảng 11,5-14,5 giờ |
| II. 26/10-20/12 (Competition và FA) | 8-10 giờ | 2 giờ | 2,5 giờ | 1 giờ | khoảng 13,5-15,5 giờ |
| III. Từ 21/12 (GCI đã xong) | 0 | 5 giờ | 2 giờ | 3 giờ | khoảng 10 giờ |

## 4. Tuần mẫu (nguồn quyết định ngày học)

**Giai đoạn I (đến 25/10)**

| Ngày | Buổi chính | Buổi phụ |
| :--- | :--- | :--- |
| Thứ Hai | Python Master, buổi A (60 phút) | AMD (30-60 phút) |
| Thứ Ba | Machine Learning, buổi A: lý thuyết đúng chủ đề GCI thứ Năm này (70 phút) | GCI: đọc trước slide buổi tới (30 phút) |
| Thứ Tư | Python Master: ôn D+3 (15 phút) | Không |
| Thứ Năm | GCI live 18:00-19:30, nộp survey ngay | Không |
| Thứ Sáu | GCI: làm lại notebook bài giảng (75 phút) | AMD (30 phút) |
| Thứ Bảy | GCI: homework (90 phút) | Machine Learning, buổi B: tự cài đặt rồi so với scikit-learn (95 phút) |
| Chủ Nhật | Python Master, buổi B (90 phút) | Machine Learning hoặc GCI xen kẽ (60 phút) và ôn xuyên khóa (20 phút) |

**Giai đoạn II (26/10-20/12)**

| Ngày | Buổi chính | Buổi phụ |
| :--- | :--- | :--- |
| Thứ Hai | GCI Competition (90 phút) | Python Master, buổi A (60 phút) |
| Thứ Ba | Machine Learning, buổi A (50 phút) | Không |
| Thứ Tư | GCI Final Assignment (60 phút) | AMD (30 phút) |
| Thứ Năm | GCI live 18:00-19:30, nộp survey ngay | Không |
| Thứ Sáu | GCI: notebook và homework (90 phút) | Không |
| Thứ Bảy | GCI Competition hoặc FA (120 phút) | Machine Learning, buổi B (70 phút) |
| Chủ Nhật | Python Master, buổi B hoặc đề thi thử (90 phút) | Machine Learning hoặc GCI xen kẽ (60 phút) và ôn xuyên khóa (20 phút) |

**Giai đoạn III (từ 21/12)**

| Ngày | Buổi chính | Buổi phụ |
| :--- | :--- | :--- |
| Thứ Hai | Python Master (45 phút) | Dự phòng |
| Thứ Ba | Machine Learning (90 phút) | Không |
| Chủ Nhật | Ôn xuyên khóa và nghi thức tuần (30 phút) | Nghỉ |

## 5. Mốc 10 tuần tới

| Tuần | GCI (P0) | Machine Learning | Python Master | AMD Agents |
| :--- | :--- | :--- | :--- | :--- |
| 12-18/10 | Nộp HW3 trước 16/10; học Buổi 5 (15/10) | M1 + M2.1: hồi quy tuyến tính tự cài | M0 chẩn đoán (13/10); M1 | M0: \`verify_labs.py\` 4/4 |
| 19-25/10 | Học Buổi 6 (22/10) | M2.2 + M3.1: logistic | M1, M2 | M1: Lab 1 |
| 26/10-01/11 | Buổi 7 (29/10) | M2.3: cây | M2, M3 | M1 xong |
| 30/11-06/12 | Buổi 12 (03/12) | M5: chuỗi thời gian | M7 | M4 |
`;

put(join(HUB, "ACTIVE_LEARNING.md"), alLines.join("\n"));
put(join(HUB, "TASKS.md"), centralLines.join("\n"));
put(join(GCI, "TASKS.md"), gciLines.join("\n"));
put(join(ML, "TASKS.md"), mlLines.join("\r\n")); // CRLF on purpose: raw must not contain \r
put(join(PM, "TASKS.md"), pmLines.join("\n"));
put(join(HUB, "Roadmaps", "MASTER_ROADMAP.md"), planMd);

// Line numbers inside the fixture (for "file:line" assertions)
const LN = {
  alWatchMl: lineNo(alLines, "Machine Learning: Cài đặt"),
  alWatchHw4: lineNo(alLines, "GCI World: Nộp Homework HW4"),
  alGciDeadline: lineNo(alLines, `- Deadline: ${dlStr(D_30H)}`),
  alPmDeadline: lineNo(alLines, `- Deadline: ${dlStr(D_5H)}`),
  mlV1: lineNo(mlLines, "Cài đặt thuật toán Ridge"),
  mlKnn: lineNo(mlLines, "K-Nearest Neighbors"),
  mlNotag: lineNo(mlLines, "Ghi chú ý tưởng"),
  mlNew: lineNo(mlLines, "M3.3a"),
  gciSurvey4: lineNo(gciLines, "Buổi 4"),
  gciHw4: lineNo(gciLines, "`HW4`"),
  gciNoPrio: lineNo(gciLines, "thiếu Priority"),
  gciSurvey1A: lineNo(gciLines, "Làm Khảo sát điểm danh Buổi 1"),
  gciSurvey1B: lineNo(gciLines, "Hoàn thành)."),
  pm5h: lineNo(pmLines, "Nộp bài Python"),
  centralOld: lineNo(centralLines, "link validator"),
};

// Vega
put(
  join(HUB, ".vega", "cards.json"),
  JSON.stringify({
    version: 1,
    settings: { request_retention: 0.9 },
    cards: [
      { id: "c_due1", subject: "Machine_Learning", front: "Ridge phạt gì?", back: "Bình phương hệ số", fsrs: { due: at(-1 * H).toISOString(), state: 2 } },
      { id: "c_later", subject: "Machine_Learning", front: "Lasso phạt gì?", back: "Trị tuyệt đối", fsrs: { due: at(10 * 24 * H).toISOString(), state: 2 } },
    ],
  }),
);
put(
  join(HUB, ".vega", "reviews.jsonl"),
  [
    { t: T(13, 9, 0), card: "c_due1", rating: "good", via: "tool" },
    { t: T(14, 9, 0), card: "c_later", rating: "again", via: "tool" },
    { t: "2026-10-05T09:00:00+07:00", card: "c_due1", rating: "good", via: "tool" },
    { t: T(13, 9, 5), card: "c_due1", rating: "deleted" },
  ]
    .map((o) => JSON.stringify(o))
    .join("\n") + "\n",
);

// Polaris (Machine Learning: error log + reviews; Python Master: schedule)
put(
  join(ML, "polaris", "errorlog.md"),
  [
    "# Sổ lỗi (Error Log & Predict Gaps)",
    "",
    "### [2026-10-13] Lệch dự đoán - Module M1",
    "- **Nguyên nhân gốc rễ:** quên chuẩn hóa dữ liệu.",
    "",
    "### [2026-10-05] Trắc nghiệm sai",
    "- **Nguyên nhân gốc rễ:** nhầm L1 và L2.",
    "",
  ].join("\n"),
);
put(
  join(ML, "polaris", "reviews.json"),
  JSON.stringify({
    updated: "2026-10-11",
    items: [
      {
        id: "ERR_2026-10-11_ab12cd",
        type: "error",
        title: "Sổ lỗi: chuẩn hóa dữ liệu trước khi hồi quy",
        createdDate: "2026-10-11",
        steps: [
          { dayOffset: 1, dueDate: "2026-10-12", done: false },
          { dayOffset: 3, dueDate: "2026-10-14", done: false },
          { dayOffset: 2, dueDate: "2026-10-13", done: true, doneDate: "2026-10-13" },
        ],
      },
    ],
  }),
);
put(join(PM, "polaris", "schedule.json"), JSON.stringify({ startDate: "2026-10-12", weeks: [] }));

// Orion lab + Aurora/Mira progress (listed in SIRIUS_EVIDENCE_DIRS; SmartDrive is off in the tests)
const LAB = join(GCI, "Lab_Pareto");
put(
  join(LAB, "lab.json"),
  JSON.stringify({ title: "Pareto lab", subject: "GCI World 2026", language: "python", entry: "x.py", tests: { runner: "pytest" }, dod: ["a"], checks: {} }),
);
put(
  join(LAB, "orion-attempts.jsonl"),
  [
    { type: "attempt", timestamp: T(13, 10, 0), attempt: 1, passed: false, total: 3, passedCount: 1, failedCount: 2, durationMs: 1200, tests: [] },
    { type: "hint", timestamp: T(13, 10, 5), check: "t1", level: 1, concept: "c", hint: "h" },
    { type: "attempt", timestamp: T(14, 10, 0), attempt: 2, passed: false, total: 3, passedCount: 2, failedCount: 1, durationMs: 800, tests: [] },
    { type: "attempt", timestamp: "2026-10-05T10:00:00+07:00", attempt: 0, passed: true, total: 3, passedCount: 3, failedCount: 0, durationMs: 500, tests: [] },
  ]
    .map((o) => JSON.stringify(o))
    .join("\n") + "\n",
);
const AUR = join(GCI, "aurora_out");
put(
  join(AUR, "progress.jsonl"),
  [
    { v: 1, t: T(13, 11, 0), deck: "d", slide: 1, type: "quiz", correct: true },
    { v: 1, t: T(13, 11, 5), deck: "d", slide: 2, type: "predict", rating: "right" },
    { v: 1, t: T(14, 12, 0), deck: "mira-lab", slide: 3, slideId: "mira-stop-3", type: "predict", rating: "right" },
    { v: 1, t: T(14, 12, 5), deck: "mira-lab", slide: 4, slideId: "mira-stop-4", type: "predict", rating: "different" },
    { v: 1, t: "2026-10-05T11:00:00+07:00", deck: "d", slide: 1, type: "quiz", correct: false },
  ]
    .map((o) => JSON.stringify(o))
    .join("\n") + "\n",
);
put(
  join(AUR, "aurora-progress-mira-2026-10.jsonl"),
  JSON.stringify({ v: 1, t: T(14, 13, 0), deck: "mira-lab", slide: 5, slideId: "mira-stop-5", type: "predict", rating: "right" }) + "\n",
);
const EVIDENCE_DIRS = `${LAB};${AUR}`;

// Rigel: activity.jsonl of the grounded Q&A server (SIRIUS_RIGEL_HOME points here)
const STUDY_HOME = join(TEST_DIR, "study_home");
const STUDY_MARK = "ZZ_SECRET_QUERY_TEXT_7f3a"; // pretend query text: it must never show up in any Sirius output or file
const sl = (t, tool, course, subject, extra = {}) =>
  JSON.stringify({ v: 1, t, tool, course, lesson: course ? "02_NumPy" : null, subject, hits: 1, ...extra });
const STUDY_LINES = [
  // inside the week 2026-W42 (12/10-18/10)
  sl(T(13, 10, 40), "search_material", "GCI", "GCI_World_2026_September", { coverage: "strong", hits: 3, query: STUDY_MARK }),
  sl(T(13, 10, 45), "search_material", "GCI", null, { coverage: "weak", hits: 1, q: STUDY_MARK }), // no subject: the course alias GCI
  sl(T(13, 11, 0), "search_material", "GCI", "GCI_World_2026_September", { coverage: "none", hits: 0 }),
  sl(T(13, 11, 10), "export_flashcards", "GCI", "GCI_World_2026_September", { cards: 5 }),
  sl(T(13, 11, 20), "read_chunks", "GCI", "GCI_World_2026_September", { hits: 2 }), // logged by Rigel, not counted
  sl(T(13, 11, 25), "lesson_outline", "Silent Course", null), // not counted, so it cannot raise a note either
  "", // blank line
  sl(T(14, 9, 0), "search_material", "ML", "Machine_Learning", { coverage: "strong", hits: 4 }),
  sl(T(14, 9, 5), "search_material", "GCI", "Machine_Learning", { coverage: "weak" }), // the subject beats the course
  sl(T(14, 9, 10), "save_note", "ML", null), // no subject: the course alias ML
  sl(T(14, 9, 20), "search_material", "PM", "No_Such_Subject", { coverage: "strong" }), // unknown subject falls back to the course
  sl(T(14, 9, 30), "search_material", "Zeta Course", null, { coverage: "none", hits: 0 }), // matches no subject: bucket khác
  sl(T(14, 9, 40), "export_flashcards", null, "Ghost_Subject", { cards: 2 }), // the same, and no course at all
  // bad lines: not JSON, bad timestamp, no timestamp, other version, unknown tool
  "this line is not json",
  JSON.stringify({ v: 1, t: "not-a-date", tool: "search_material", course: "GCI", coverage: "strong" }),
  JSON.stringify({ v: 1, tool: "search_material", course: "GCI", coverage: "strong" }),
  JSON.stringify({ v: 2, t: T(14, 10, 0), tool: "search_material", course: "GCI", coverage: "strong" }),
  JSON.stringify({ v: 1, t: T(14, 10, 5), tool: "frobnicate", course: "GCI" }),
  // outside the week
  sl(T(6, 10, 0), "search_material", "GCI", "GCI_World_2026_September", { coverage: "strong" }), // previous week (W41)
  sl(T(19, 10, 0), "search_material", "ML", "Machine_Learning", { coverage: "weak" }), // next week (W43)
];
put(join(STUDY_HOME, "activity.jsonl"), STUDY_LINES.join("\n") + "\n");
// other places Rigel may live: RIGEL_HOME, <home>/.rigel, a log above the 4 MB bound, a log that cannot be read
const STUDY_ALT = join(TEST_DIR, "study_alt");
put(
  join(STUDY_ALT, "activity.jsonl"),
  [sl(T(15, 9, 0), "search_material", "GCI", "GCI_World_2026_September", { coverage: "strong" }), sl(T(15, 9, 5), "save_note", "GCI", "GCI_World_2026_September")].join("\n") + "\n",
);
const FAKE_HOME = join(TEST_DIR, "fake_home");
put(join(FAKE_HOME, ".rigel", "activity.jsonl"), sl(T(16, 9, 0), "export_flashcards", "PM", null, { cards: 3 }) + "\n");
const EMPTY_HOME = join(TEST_DIR, "empty_home");
mkdirSync(EMPTY_HOME, { recursive: true });
const STUDY_EMPTY = join(TEST_DIR, "study_empty");
mkdirSync(STUDY_EMPTY, { recursive: true });
const STUDY_MISSING = join(TEST_DIR, "study_missing"); // never created
const STUDY_BIG = join(TEST_DIR, "study_big");
const STUDY_FILLER = sl("2026-01-05T10:00:00+07:00", "search_material", "GCI", "GCI_World_2026_September", { coverage: "strong", hits: 3 });
put(
  join(STUDY_BIG, "activity.jsonl"),
  Array(32000).fill(STUDY_FILLER).join("\n") +
    "\n" +
    [sl(T(16, 10, 0), "search_material", "GCI", "GCI_World_2026_September", { coverage: "strong" }), sl(T(16, 10, 5), "export_flashcards", "GCI", "GCI_World_2026_September", { cards: 4 })].join("\n") +
    "\n",
);
const STUDY_DIRLOG = join(TEST_DIR, "study_dirlog");
mkdirSync(join(STUDY_DIRLOG, "activity.jsonl"), { recursive: true }); // a folder where the log should be

// Git: the hub repo (ML commits live inside it), a nested repo for Python Master, and a tooling repo
const hasGit = spawnSync("git", ["--version"], { encoding: "utf8" }).status === 0;
const TOOLING = join(TEST_DIR, "tooling_repo");
const CONST_HOME = join(TEST_DIR, "constellation_empty");
mkdirSync(CONST_HOME, { recursive: true });
const git = (cwd, args, date) =>
  spawnSync("git", ["-c", "core.autocrlf=false", "-c", "commit.gpgsign=false", ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Sirius E2E",
      GIT_AUTHOR_EMAIL: "e2e@example.invalid",
      GIT_COMMITTER_NAME: "Sirius E2E",
      GIT_COMMITTER_EMAIL: "e2e@example.invalid",
      ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}),
    },
  });
if (hasGit) {
  git(HUB, ["init", "-q"]);
  git(HUB, ["add", "-A"]);
  git(HUB, ["commit", "-q", "-m", "initial hub fixture"], "2026-09-20T10:00:00+07:00");
  put(join(ML, "notes_a.txt"), "a\n");
  git(HUB, ["add", "Machine_Learning/notes_a.txt"]);
  git(HUB, ["commit", "-q", "-m", "ml: notes a"], "2026-10-13T10:00:00+07:00");
  put(join(ML, "notes_b.txt"), "b\n");
  git(HUB, ["add", "Machine_Learning/notes_b.txt"]);
  git(HUB, ["commit", "-q", "-m", "ml: notes b"], "2026-10-14T10:00:00+07:00");
  git(PM, ["init", "-q"]);
  put(join(PM, "solution.txt"), "s\n");
  git(PM, ["add", "solution.txt"]);
  git(PM, ["commit", "-q", "-m", "pm: solution"], "2026-10-13T11:00:00+07:00");
  mkdirSync(TOOLING, { recursive: true });
  git(TOOLING, ["init", "-q"]);
  for (const [i, d] of ["2026-10-13T12:00:00+07:00", "2026-10-14T12:00:00+07:00", "2026-10-15T12:00:00+07:00"].entries()) {
    put(join(TOOLING, `f${i}.txt`), `${i}\n`);
    git(TOOLING, ["add", "-A"]);
    git(TOOLING, ["commit", "-q", "-m", `tooling ${i}`], d);
  }
} else {
  console.log("note: git is not available; git evidence checks are skipped");
  mkdirSync(TOOLING, { recursive: true });
}

// Fake SmartDrive command for the post-write hook test
const FAKE_SD = join(TEST_DIR, "fake_smart_drive.mjs");
const SD_MARKER = join(TEST_DIR, "smartdrive_calls.log");
put(
  FAKE_SD,
  `import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
if (process.env.FAKE_SD_MARKER) appendFileSync(process.env.FAKE_SD_MARKER, JSON.stringify(args) + "\\n");
if (args[0] === "search") console.log("[]");
`,
);

/* ───────── Snapshots for the invariants ───────── */

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === ".git") continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const mdHashes = new Map();
for (const f of walk(HUB)) if (f.toLowerCase().endsWith(".md")) mdHashes.set(relative(HUB, f), sha(f));
const filesBefore = new Set(walk(HUB).map((f) => relative(HUB, f)));
// Every folder Rigel data is read from: Sirius must leave them byte-identical (and create nothing next to them).
const snapDir = (dir) => {
  if (!existsSync(dir)) return "(missing)";
  const out = [];
  const rec = (d) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      const rel = relative(dir, p).replace(/\\/g, "/");
      if (statSync(p).isDirectory()) {
        out.push(`${rel}/`);
        rec(p);
      } else {
        out.push(`${rel}:${sha(p)}`);
      }
    }
  };
  rec(dir);
  return out.join("|");
};
const STUDY_SNAP_DIRS = [STUDY_HOME, STUDY_ALT, STUDY_BIG, FAKE_HOME, STUDY_EMPTY, EMPTY_HOME, STUDY_DIRLOG, STUDY_MISSING];
const studyBefore = STUDY_SNAP_DIRS.map(snapDir);

/* ───────── Environment and clients ───────── */

function cleanEnv() {
  const e = { ...process.env };
  for (const k of Object.keys(e)) {
    if (/^(SIRIUS_|POLARIS_HUB$|CONSTELLATION_HOME$|FAKE_SD_MARKER$|RIGEL_HOME$)/.test(k)) delete e[k];
  }
  return e;
}
const SERVER_ENV = {
  ...cleanEnv(),
  SIRIUS_HUB: HUB,
  SIRIUS_NOW: NOW_ISO,
  SIRIUS_SMARTDRIVE: "off",
  SIRIUS_EVIDENCE_DIRS: EVIDENCE_DIRS,
  SIRIUS_TOOLING_DIRS: TOOLING,
  SIRIUS_RIGEL_HOME: STUDY_HOME,
  CONSTELLATION_HOME: CONST_HOME,
};
function runCli(args, extraEnv = {}, removeEnv = []) {
  const env = { ...SERVER_ENV, ...extraEnv };
  for (const k of removeEnv) delete env[k];
  const r = spawnSync(process.execPath, [DIST, ...args], { encoding: "utf8", env, timeout: 120000 });
  return { code: r.status, out: collect(r.stdout ?? ""), err: r.stderr ?? "" };
}

console.log(`\n=== Running Sirius MCP E2E Tests in ${TEST_DIR} ===\n`);

const client = new Client({ name: "sirius-e2e", version: "1.0.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [DIST],
  stderr: "inherit",
  env: SERVER_ENV,
});
await client.connect(transport);
const call = async (name, args = {}) => {
  let r;
  try {
    r = await client.callTool({ name, arguments: args }, undefined, { timeout: 90000 });
  } catch (e) {
    // protocol-level validation errors are reported like tool errors
    r = { isError: true, content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }] };
  }
  collect(textOf(r));
  return r;
};

const journalFile = join(HUB, ".sirius", "journal.jsonl");
const readJournalLines = () =>
  existsSync(journalFile)
    ? readFileSync(journalFile, "utf8")
        .split("\n")
        .filter((l) => l.trim())
    : [];
const VIET = /[ăâđêôơưáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/i;

try {
  /* ───────── 1. Server identity, instructions, tools ───────── */
  section("server identity, instructions, tools");
  const info = client.getServerVersion();
  ok("server identifies itself as sirius 0.1.1", info?.name === "sirius" && info?.version === "0.1.1", JSON.stringify(info));
  const instructions = client.getInstructions() ?? "";
  ok(
    "instructions contain Workflow:, Rules:, Done when:",
    instructions.includes("Workflow:") && instructions.includes("Rules:") && instructions.includes("Done when:"),
  );
  ok(
    "instructions say to record only confirmed decisions and never edit learner files",
    /ONLY the decisions the learner confirmed/.test(instructions) && /Never edit TASKS\.md/.test(instructions),
  );
  ok(
    "instructions list Rigel among the read-only evidence and say Sirius never logs query text",
    /Polaris, Rigel and git is read-only/.test(instructions) && /never logs query text/.test(instructions),
  );
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  const EXPECTED = [
    "sirius_commit",
    "sirius_deadlines",
    "sirius_guide",
    "sirius_log",
    "sirius_start",
    "sirius_stats",
    "sirius_stop",
    "sirius_today",
    "sirius_triage",
    "sirius_week",
  ];
  ok("exactly 10 tools registered", names.length === 10 && EXPECTED.every((n) => names.includes(n)), names.join(", "));
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  ok(
    "read-only tools are annotated readOnlyHint true, writers false",
    ["sirius_guide", "sirius_deadlines", "sirius_today", "sirius_stats"].every((n) => byName[n]?.annotations?.readOnlyHint === true) &&
      ["sirius_triage", "sirius_commit", "sirius_start", "sirius_stop", "sirius_log", "sirius_week"].every(
        (n) => byName[n]?.annotations?.readOnlyHint === false,
      ) &&
      tools.every((t) => t.annotations?.openWorldHint === false),
  );
  ok(
    "tool descriptions and input schemas present; triage says to record only confirmed decisions",
    tools.every((t) => t.description && t.inputSchema) && /confirmed/.test(byName.sirius_triage?.description ?? ""),
  );
  ok(
    "sirius_week and sirius_stats descriptions mention the Rigel evidence",
    /Rigel/.test(byName.sirius_week?.description ?? "") && /Rigel/.test(byName.sirius_stats?.description ?? "") && /grounded questions/.test(byName.sirius_stats?.description ?? ""),
  );

  /* ───────── 2. Guide ───────── */
  section("guide");
  let r = await call("sirius_guide");
  ok("guide index is Vietnamese and lists topics", !r.isError && VIET.test(textOf(r)) && textOf(r).includes("deadlines") && textOf(r).includes("evidence"));
  for (const topic of ["overview", "deadlines", "triage", "plan", "sessions", "week", "evidence", "rules"]) {
    r = await call("sirius_guide", { topic });
    ok(`guide topic ${topic} is non-empty Vietnamese`, !r.isError && textOf(r).length > 400 && VIET.test(textOf(r)));
  }
  r = await call("sirius_guide", { topic: "evidence" });
  const ev = textOf(r);
  ok(
    "guide evidence lists Vega, Orion, Aurora, Mira, Polaris, git and says Sirius never writes into them",
    ["Vega", "Orion", "Aurora", "Mira", "Polaris", "git", ".vega/", "orion-attempts.jsonl", "errorlog.md", "reviews.json", "mira-stop-"].every((s) => ev.includes(s)) &&
      /KHÔNG BAO GIỜ ghi vào chúng/.test(ev),
  );
  ok(
    "guide evidence describes Rigel: file, folder variables, counted tools, the khác bucket, the column strings, and that query text is never logged",
    ["Rigel", "activity.jsonl", "SIRIUS_RIGEL_HOME", "RIGEL_HOME", ".rigel", "search_material", "export_flashcards", "save_note", '"khác"', "Hỏi đáp có nguồn N (mạnh a, yếu b, không c)", "Thẻ từ tài liệu M"].every((s) => ev.includes(s)) &&
      /chỉ ĐỌC `activity\.jsonl`/.test(ev) &&
      /không bao giờ ghi lại nội dung câu hỏi/.test(ev),
  );
  r = await call("sirius_guide", { topic: "rules" });
  ok(
    "guide rules mentions the .sirius/.gitignore content",
    textOf(r).includes("# Created by Sirius: personal study data, never commit.") && textOf(r).includes("không bao giờ ghi đè"),
  );
  ok("guide rules lists SIRIUS_RIGEL_HOME and RIGEL_HOME", textOf(r).includes("SIRIUS_RIGEL_HOME") && textOf(r).includes("RIGEL_HOME"));
  r = await call("sirius_guide", { topic: "week" });
  ok("guide week mentions the Rigel evidence and the optional stats table", textOf(r).includes("Rigel") && textOf(r).includes("Hỏi đáp có nguồn theo tuần"));
  r = await call("sirius_guide");
  ok("guide index lists Rigel among the evidence sources", textOf(r).includes("Polaris, Rigel, git"));

  /* ───────── 3. Unit-level checks on exported helpers ───────── */
  section("helpers (countdown, ISO week, plan cells, tokenizer, streak)");
  const mins = (m) => m * 60000;
  ok("countdown 23 h 12 min", lib.formatCountdown(mins(23 * 60 + 12)) === "còn 23 giờ 12 phút");
  ok("countdown 2 days 5 h", lib.formatCountdown(mins(2 * 1440 + 5 * 60)) === "còn 2 ngày 5 giờ");
  ok("countdown overdue 16 days 1 h", lib.formatCountdown(-mins(16 * 1440 + 60)) === "quá hạn 16 ngày 1 giờ");
  ok("countdown overdue 40 min (zero hours omitted)", lib.formatCountdown(-mins(40)) === "quá hạn 40 phút");
  ok("ISO week of 2026-10-12 is 2026-W42", lib.isoWeekOf("2026-10-12").label === "2026-W42");
  ok(
    "ISO week-numbering year at year ends",
    lib.isoWeekOf("2027-01-01").label === "2026-W53" && lib.isoWeekOf("2024-12-30").label === "2025-W01",
  );
  ok("Vietnamese weekday names", lib.viWeekday("2026-10-12") === "Thứ Hai" && lib.viWeekday("2026-10-18") === "Chủ Nhật");
  const subj = (key, name) => lib.makeSubject({ key, name, dir: `/x/${key}` });
  const SUBJ = [subj("GCI_World_2026_September", "GCI World 2026"), subj("Machine_Learning", "Machine Learning"), subj("Python_Master", "Python Master"), subj("Quantum_Computing", "Quantum Computing")];
  const warns = [];
  const w = (l, m) => warns.push(`${l}:${m}`);
  const cellGlue = lib.parseCell("GCI: notebook và homework (90 phút)", SUBJ, 1, w);
  ok("cell with 'và' inside one session stays one session of 90 minutes", cellGlue.length === 1 && cellGlue[0].subject === "GCI_World_2026_September" && cellGlue[0].minutes?.min === 90);
  const cellAlt = lib.parseCell("Quantum hoặc Machine Learning xen kẽ (60 phút) và ôn xuyên khóa (20 phút)", SUBJ, 1, w);
  ok(
    "alternatives plus review segment",
    cellAlt.length === 2 && cellAlt[0].alternatives?.length === 2 && cellAlt[0].minutes?.max === 60 && cellAlt[1].kind === "review" && cellAlt[1].subject === null && cellAlt[1].minutes?.min === 20,
    JSON.stringify(cellAlt),
  );
  const cellClock = lib.parseCell("GCI live 18:00-19:30, nộp survey ngay", SUBJ, 1, w);
  ok("clock range gives 90 minutes", cellClock.length === 1 && cellClock[0].minutes?.min === 90);
  const cellOne = lib.parseCell("Python Master, buổi B hoặc đề thi thử (90 phút)", SUBJ, 1, w);
  ok("hoặc with one resolvable part uses it", cellOne.length === 1 && cellOne[0].subject === "Python_Master" && !cellOne[0].alternatives);
  ok("Không gives no session; Nghỉ rest; Dự phòng buffer",
    lib.parseCell("Không", SUBJ, 1, w).length === 0 && lib.parseCell("Nghỉ", SUBJ, 1, w)[0].kind === "rest" && lib.parseCell("Dự phòng", SUBJ, 1, w)[0].kind === "buffer");
  ok("review with extra words keeps its minutes", lib.parseCell("Ôn xuyên khóa và nghi thức tuần (30 phút)", SUBJ, 1, w)[0].minutes?.min === 30);
  const cellUnknown = lib.parseCell("AMD (30-60 phút)", SUBJ, 7, w);
  ok("unknown label keeps the label, subject null, minutes range, warning", cellUnknown[0].subject === null && cellUnknown[0].label === "AMD (30-60 phút)" && cellUnknown[0].minutes?.max === 60 && warns.some((x) => x.startsWith("7:")));
  const tok = lib.tokenSeq("Cài đặt Ridge/Lasso trong [01_Regression](file:///D:/x/y) M3.3a hw4 deadline");
  ok("tokenizer strips link targets, stopwords and noise; keeps codes", tok.includes("ridge") && tok.includes("lasso") && tok.includes("regression") && tok.includes("m3.3a") && tok.includes("hw4") && !tok.includes("deadline") && !tok.includes("file"), tok.join(","));
  ok("number tokens ignore dates and keep codes", [...lib.numberTokens("Buổi 4 hạn 2026-10-23 08:00 mốc 1.5 và 02")].sort().join(",") === "1.5,2,4");
  // streak tolerant to one miss
  const sess = (date, minutes = 30, kind = "learn") => ({ v: 1, type: "session", start: `${date}T20:00:00`, minutes, kind, subject: "x" });
  ok("streak: single-day gap keeps it", lib.computeStreak([sess("2026-10-16"), sess("2026-10-14"), sess("2026-10-13")], "2026-10-16").streak === 3 && lib.computeStreak([sess("2026-10-16"), sess("2026-10-14"), sess("2026-10-13")], "2026-10-16").spanDays === 4);
  ok("streak: two-day gap breaks it", lib.computeStreak([sess("2026-10-16"), sess("2026-10-13")], "2026-10-16").streak === 1);
  ok("streak: today counts only when it has a qualifying session", lib.computeStreak([sess("2026-10-15"), sess("2026-10-14")], "2026-10-16").streak === 2 && lib.computeStreak([sess("2026-10-16", 5), sess("2026-10-15")], "2026-10-16").todayCounts === false);
  ok("streak: meta and short sessions do not count", lib.computeStreak([sess("2026-10-16", 30, "meta"), sess("2026-10-15", 9)], "2026-10-16").streak === 0);
  // plan parser queries
  const planObj = lib.parsePlan(planMd, SUBJ, NOW);
  ok(
    "plan: 3 phases with dates, the last one open-ended",
    planObj.phases.length === 3 && planObj.phases[0].start === "2026-10-12" && planObj.phases[0].end === "2026-10-25" && planObj.phases[1].start === "2026-10-26" && planObj.phases[1].end === "2026-12-20" && planObj.phases[2].start === "2026-12-21" && planObj.phases[2].end === null,
    planObj.phases.map((p) => `${p.id}:${p.start}..${p.end}`).join(" "),
  );
  ok(
    "plan: budgets with decimal commas and ranges (unknown AMD column dropped with a warning)",
    planObj.phases[0].budget.GCI_World_2026_September.min === 5 && planObj.phases[0].budget.GCI_World_2026_September.max === 6.5 && planObj.phases[0].budget.Python_Master.min === 2.5 && planObj.phases[2].budget.GCI_World_2026_September.max === 0 && planObj.warnings.some((x) => x.includes('"AMD"')),
  );
  ok(
    "getPhaseFor / getDayPlan / getWeekBudget / getMilestones",
    lib.getPhaseFor(planObj, "2026-10-25")?.id === "I" && lib.getPhaseFor(planObj, "2026-10-26")?.id === "II" && lib.getPhaseFor(planObj, "2026-12-21")?.id === "III" && lib.getPhaseFor(planObj, "2026-10-11") === undefined &&
      lib.getDayPlan(planObj, "2026-10-12")?.day?.main[0]?.minutes?.min === 60 && lib.getWeekBudget(planObj, "2026-10-26")?.total.min === 12.5 && lib.getWeekBudget(planObj, "2026-10-26")?.phase.id === "II" &&
      lib.getMilestones(planObj, "2026-11-01")?.bySubject.Machine_Learning === "M2.3: cây" && lib.getMilestones(planObj, "2026-12-03")?.from === "2026-11-30",
  );
  const planYear = lib.parsePlan(
    "# Plan (cập nhật 2026-12-01)\n\n## 3. Ngân sách\n\n| Giai đoạn | GCI | Tổng |\n| :--- | :--- | :--- |\n| I. 28/12-03/01 (Cuối năm) | 2 giờ | 2 giờ |\n| II. Từ 04/01 (Đầu năm) | 3 giờ | 3 giờ |\n\n## 5. Mốc\n\n| Tuần | GCI |\n| :--- | :--- |\n| 28/12-03/01 | x |\n| 04-10/01 | y |\n",
    SUBJ,
    NOW,
  );
  ok(
    "plan: a range whose end month is smaller crosses into the next year",
    planYear.phases[0].start === "2026-12-28" && planYear.phases[0].end === "2027-01-03" && planYear.phases[1].start === "2027-01-04" && planYear.milestones[0].to === "2027-01-03" && planYear.milestones[1].from === "2027-01-04",
    JSON.stringify(planYear.phases.map((p) => [p.start, p.end])),
  );
  ok("plan: missing sections give warnings, never throw", lib.parsePlan("# Không có gì (cập nhật 2026-10-10)\n", SUBJ, NOW).warnings.length >= 3);
  // commitment statuses (kept / late / missed / pending)
  const cm = { v: 1, type: "commit", at: "2026-10-12T00:00:00+07:00", id: "c_11111111", date: "2026-10-12", time: "08:00", subject: "PM", action: "x", minutes: 25 };
  const ss = (hh, mm, extra = {}) => ({ v: 1, type: "session", at: "x", id: "s_22222222", subject: "PM", kind: "learn", start: isoLocal(local(2026, 10, 12, hh, mm)), end: "x", minutes: 30, outcome: "done", source: "log", ...extra });
  const st0 = (sessions, now) => lib.commitStatus(cm, sessions, now);
  ok(
    "commitment status: pending / kept (window -30 .. +90 min) / late / missed",
    st0([], local(2026, 10, 12, 7, 0)) === "pending" && st0([ss(7, 30)], local(2026, 10, 12, 12, 0)) === "kept" && st0([ss(9, 30)], local(2026, 10, 12, 12, 0)) === "kept" && st0([ss(9, 31)], local(2026, 10, 12, 12, 0)) === "late" &&
      st0([ss(7, 29)], local(2026, 10, 12, 12, 0)) === "pending" && st0([], local(2026, 10, 13, 8, 0)) === "missed" && st0([ss(20, 0, { commitId: "c_11111111" })], local(2026, 10, 12, 21, 0)) === "late" && st0([ss(8, 5, { commitId: "c_11111111" })], local(2026, 10, 12, 9, 0)) === "kept",
  );
  // Rigel tally (pure): the line's subject first, then its course alias, then the "khác" bucket with a note
  const AMD = subj("AMD_AI_Academy_AI_Agents_101", "AMD AI Academy: AI Agents 101");
  const SUBJ_S = [...SUBJ, AMD];
  const evS = (tool, course, subject, extra = {}) => ({ ts: "2026-10-13T10:00:00+07:00", tool, ...(course ? { course } : {}), ...(subject ? { subject } : {}), cards: 0, ...extra });
  const tallied = lib.tallyStudy(
    [
      evS("search_material", "GCI", "Machine_Learning", { coverage: "weak" }),
      evS("search_material", "QC", undefined, { coverage: "strong" }),
      evS("search_material", "AMD", "Nope", { coverage: "none" }),
      evS("save_note", "PM"),
      evS("export_flashcards", "ML", undefined, { cards: 4 }),
      evS("search_material", "XYZ", undefined, { coverage: "strong" }),
      evS("search_material", undefined, undefined, { coverage: "weak" }),
      { ...evS("search_material", "GCI", undefined, { coverage: "strong" }), ts: "2026-10-20T10:00:00+07:00" },
    ],
    { from: "2026-10-12", to: "2026-10-18" },
    SUBJ_S,
  );
  const cnt = (s) => (s ? [s.questions, s.strong, s.weak, s.none, s.cards, s.notes].join("/") : "-");
  ok(
    "study tally: the subject beats the course; ML, QC, PM, AMD aliases resolve; unknown goes to khác; out of range is ignored",
    cnt(tallied.data.bySubject.Machine_Learning) === "1/0/1/0/4/0" &&
      cnt(tallied.data.bySubject.Quantum_Computing) === "1/1/0/0/0/0" &&
      cnt(tallied.data.bySubject.AMD_AI_Academy_AI_Agents_101) === "1/0/0/1/0/0" &&
      cnt(tallied.data.bySubject.Python_Master) === "0/0/0/0/0/1" &&
      cnt(tallied.data.bySubject[lib.STUDY_OTHER]) === "2/1/1/0/0/0" &&
      cnt(tallied.data.bySubject.GCI_World_2026_September) === "-" &&
      lib.STUDY_OTHER === "khác",
    JSON.stringify(tallied.data.bySubject),
  );
  ok(
    "study tally: one note counts the unmatched calls and names the labels",
    tallied.notes.length === 1 && tallied.notes[0].includes("2 lần gọi không gắn được với khóa nào") && tallied.notes[0].includes('"XYZ"') && tallied.notes[0].includes("(không có course)") && tallied.notes[0].includes('"khác"'),
    tallied.notes.join(" | "),
  );
  const tallyTotal = lib.studyTotal(tallied.data);
  ok(
    "study totals and sentence sum every bucket, khác included; empty stats are inactive",
    cnt(tallyTotal) === "5/2/2/1/4/1" &&
      lib.studySentence(tallyTotal) === "5 câu hỏi (mạnh 2, yếu 2, không 1), 4 thẻ từ tài liệu, 1 ghi chú đã lưu" &&
      lib.studyActive(tallyTotal) === true &&
      lib.studyActive(lib.emptyStudyStats()) === false &&
      lib.studySentence(lib.emptyStudyStats()) === "",
    cnt(tallyTotal),
  );
  const envKeep = [process.env.SIRIUS_RIGEL_HOME, process.env.RIGEL_HOME];
  process.env.SIRIUS_RIGEL_HOME = join(TEST_DIR, "h1");
  process.env.RIGEL_HOME = join(TEST_DIR, "h2");
  const hBoth = lib.studyHome();
  delete process.env.SIRIUS_RIGEL_HOME;
  const hLegacy = lib.studyHome();
  delete process.env.RIGEL_HOME;
  const hDefault = lib.studyHome();
  for (const [k, v] of [["SIRIUS_RIGEL_HOME", envKeep[0]], ["RIGEL_HOME", envKeep[1]]]) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  ok(
    "studyHome: SIRIUS_RIGEL_HOME, then RIGEL_HOME, then <home>/.rigel",
    hBoth.env === "SIRIUS_RIGEL_HOME" && hBoth.dir === fwdp(join(TEST_DIR, "h1")) && hLegacy.env === "RIGEL_HOME" && hLegacy.dir === fwdp(join(TEST_DIR, "h2")) && hDefault.env === undefined && hDefault.dir === fwdp(join(homedir(), ".rigel")),
    JSON.stringify([hBoth, hLegacy, hDefault]),
  );

  /* ───────── 4. Deadlines (read-only baseline) ───────── */
  section("deadlines");
  r = await call("sirius_deadlines");
  let dtext = textOf(r);
  ok("deadlines header has date, time and weekday", !r.isError && dtext.startsWith("# Kiểm tra hạn chót (2026-10-12 00:47, Thứ Hai)"), dtext.split("\n")[0]);
  ok("overdue section counts 13 items and warns first", dtext.includes("## Quá hạn: 13 mục (cảnh báo trước mọi việc khác)"));
  ok("per-board overdue counts", dtext.includes("- Python_Master/TASKS.md: 9") && dtext.includes("- Machine_Learning/TASKS.md: 2") && dtext.includes("- TASKS.md: 2"));
  const overdueBlock = dtext.slice(dtext.indexOf("## Quá hạn"), dtext.indexOf("## Khẩn cấp"));
  const overdueRows = overdueBlock.split("\n").filter((l) => l.startsWith("- [P"));
  ok("overdue rows capped at 10 by default with a pointer to detail", overdueRows.length === 10 && /còn 3 mục quá hạn nữa/.test(overdueBlock), String(overdueRows.length));
  ok("overdue rows show file:line, countdown and id", /\(Python_Master\/TASKS\.md:\d+\), quá hạn \d+ ngày \d+ giờ, id [0-9a-f]{10}/.test(overdueBlock));
  ok("overdue rows are most recently due first", overdueRows[0].includes("Giải bài luyện tập số 8") && !overdueBlock.includes("Thiết lập kiểm tra tự động"));
  ok("overdue section suggests sirius_triage", overdueBlock.includes('Gợi ý: chạy sirius_triage { action: "suggest" }'));
  ok("urgent item shows 'còn 5 giờ' and the merged project block", /## Khẩn cấp, dưới 24 giờ: 1 mục\n- \[P2\] Nộp bài Python hôm nay.*còn 5 giờ/.test(dtext) && dtext.includes(`(cũng có ở ACTIVE_LEARNING.md:${LN.alPmDeadline})`));
  ok("urgent section has a focus plan", dtext.includes("### Kế hoạch tập trung") && dtext.includes("làm ngay hôm nay, chặn lịch trước hạn; tạm dừng việc P2 khác"));
  ok("P0 due in 30 hours is in the 48 h bucket with the merged project block", /## Dưới 48 giờ: 1 mục\n- \[P0\] Nộp Attendance Survey Buổi 4.*còn 1 ngày 6 giờ/.test(dtext) && dtext.includes("Dồn buổi học hôm nay vào việc này.") && dtext.includes(`ACTIVE_LEARNING.md:${LN.alGciDeadline}`));
  ok("task due in 60 hours is in the 72 h bucket", /## Dưới 72 giờ: 1 mục\n- \[P1\] Hoàn thành chuyên đề Ma trận.*còn 2 ngày 12 giờ/.test(dtext) && dtext.includes("Nên chặn sẵn thời gian."));
  ok("later bucket counts 6 and lists the 5 nearest", dtext.includes("## Theo dõi (trên 72 giờ): 6 mục; 5 hạn gần nhất:"));
  ok("checked and fenced tasks are ignored", !dtext.includes("Task đã xong từ lâu") && !dtext.includes("khối mã") && !dtext.includes("Thiết lập bài toán Linear Regression"));
  ok("format deviations are listed with file:line", dtext.includes("## Lệch định dạng: 2 dòng") && dtext.includes(`GCI_World_2026_September/TASKS.md:${LN.gciNoPrio}: thiếu Priority`) && dtext.includes(`Machine_Learning/TASKS.md:${LN.mlNotag}: thiếu Deadline và Priority`));
  ok("project deadline is not listed separately when a task has the same minute", !dtext.includes("Dự án: Hoàn thành Attendance Survey") && !dtext.includes("Dự án: Mỗi ngày giải 1 bài"));
  ok("project deadline without a matching task stays, labelled as a project", dtext.includes("Dự án: M1 + M2.1: tự cài hồi quy"));
  ok("goal deadline stays, labelled as today's goal", dtext.includes("Mục tiêu hôm nay: Giải 1 bài Python mỗi ngày"));
  ok("cross-board duplicate HW4 merged into the project-board copy", dtext.includes(`GCI_World_2026_September/TASKS.md:${LN.gciHw4}) (cũng có ở ACTIVE_LEARNING.md:${LN.alWatchHw4})`), dtext.match(/.*HW4.*/)?.[0]);
  ok("conflicting deadlines: one pair, both file:line and both deadlines", dtext.includes("## Hạn không thống nhất: 1 cặp") && dtext.includes(`GCI_World_2026_September/TASKS.md:${LN.gciSurvey1A} (hạn 2026-10-08 18:00, đã tick)`) && dtext.includes(`GCI_World_2026_September/TASKS.md:${LN.gciSurvey1B} (hạn 2026-10-08 11:00, đã tick)`));
  ok("Buổi 2 sibling is not reported as a conflict", !dtext.includes("Buổi 2 (Attendance Survey)"));

  r = await call("sirius_deadlines", { detail: true });
  const detailBlock = textOf(r).slice(textOf(r).indexOf("## Quá hạn"), textOf(r).indexOf("## Khẩn cấp"));
  ok("detail: true lists all 13 overdue rows", detailBlock.split("\n").filter((l) => l.startsWith("- [P")).length === 13 && !/mục quá hạn nữa/.test(detailBlock));
  r = await call("sirius_deadlines", { subject: "ML" });
  ok("subject filter by alias (ML)", !r.isError && textOf(r).includes("## Quá hạn: 2 mục") && !textOf(r).includes("Giải bài luyện tập"));
  r = await call("sirius_deadlines", { subject: "Machin Lerning" });
  ok("unknown subject errors with the closest name", r.isError && textOf(r).includes("Machine Learning"), textOf(r));

  const cj = runCli(["deadlines", "--json", "--detail"]);
  let dj;
  try {
    dj = JSON.parse(cj.out);
  } catch (e) {
    dj = undefined;
  }
  ok("CLI deadlines --json parses with buckets", cj.code === 0 && dj && dj.buckets && Array.isArray(dj.buckets.overdue));
  ok(
    "JSON bucket sizes: overdue 13, urgent 1, h48 1, h72 1, later 6",
    dj && dj.buckets.overdue.length === 13 && dj.buckets.urgent.length === 1 && dj.buckets.h48.length === 1 && dj.buckets.h72.length === 1 && dj.buckets.later.length === 6,
    dj && Object.entries(dj.buckets).map(([k, v]) => `${k}=${v.length}`).join(" "),
  );
  ok("JSON has triaged, deviations, conflicts, boards", dj && dj.triaged === 0 && dj.deviations.length === 2 && dj.conflicts.length === 1 && dj.boards.length === 5 && dj.merged === 2);
  const urgentItem = dj?.buckets.urgent[0];
  ok("urgent JSON item: P2 task with alsoIn pointing at the project block", urgentItem?.kind === "task" && urgentItem.priority === "P2" && urgentItem.alsoIn?.[0] === `ACTIVE_LEARNING.md:${LN.alPmDeadline}`);
  const h48Item = dj?.buckets.h48[0];
  ok("h48 JSON item is the P0 survey", h48Item?.priority === "P0" && /Attendance Survey Buổi 4/.test(h48Item.text) && h48Item.subject === "GCI_World_2026_September");
  const allIds = [...Object.values(dj?.buckets ?? {}).flat()].map((i) => i.id);
  ok("task ids are 10 hex chars and unique", allIds.every((i) => /^[0-9a-f]{10}$/.test(i)) && new Set(allIds).size === allIds.length);
  const items = Object.values(dj?.buckets ?? {}).flat();
  const find = (substr) => items.find((i) => i.text.includes(substr));
  const ID = {
    mlV1: find("Ridge và Lasso Regularization")?.id,
    mlKnn: find("K-Nearest Neighbors")?.id,
    mlNew: find("M3.3a")?.id,
    centralOld: find("link validator")?.id,
    centralNew: find("Rà soát định kỳ")?.id,
    pmOld: find("Chuỗi và Mảng 1 chiều")?.id,
  };
  const mlV1Item = find("Ridge và Lasso Regularization");
  ok("ML v1 item merged with the watchlist copy", mlV1Item?.alsoIn?.[0] === `ACTIVE_LEARNING.md:${LN.alWatchMl}` && mlV1Item.file === "Machine_Learning/TASKS.md" && mlV1Item.line === LN.mlV1);
  ok("id formula: sha1(relative path lower | deadline | text), first 10 hex", ID.mlV1 === lib.hash("machine_learning/tasks.md|2026-09-26 23:59|" + ML_V1_TEXT, 10));
  ok("central section path: 'Workspace Infrastructure & Cross-Cutting Tasks / In Progress'", find("link validator")?.section === "Workspace Infrastructure & Cross-Cutting Tasks / In Progress");

  /* ───────── 5. Triage suggest (read-only) ───────── */
  section("triage suggest, list (read-only)");
  r = await call("sirius_triage", { action: "suggest" });
  const sug = textOf(r);
  ok("suggest: 13 untriaged overdue tasks, 1 superseded, 2 parked, 10 active", sug.includes("Tổng: 13 việc quá hạn chưa phân loại: thay thế 1, tạm gác 2, còn giá trị 10"), sug.split("\n")[3]);
  ok("suggest: ML v1 superseded with replacedBy = the '(thay task ...)' line", sug.includes(`id ${ID.mlV1}`) && sug.includes("Gợi ý: superseded") && sug.includes(`Thay bởi: id ${ID.mlNew} (Machine_Learning/TASKS.md:${LN.mlNew}`));
  ok("suggest: tells the agent to show suggestions and record only confirmed decisions", sug.includes("chỉ ghi các quyết định họ đã xác nhận trong chat"));
  const jsonBlock = /```json\n([\s\S]*?)\n```/.exec(sug);
  let recArr;
  try {
    recArr = JSON.parse(jsonBlock?.[1] ?? "null");
  } catch {
    recArr = undefined;
  }
  ok("suggest ends with a JSON array usable for record", Array.isArray(recArr) && recArr.length === 13);
  const recMl = recArr?.find((x) => x.id === ID.mlV1);
  ok("record array: ML v1 superseded with replacedBy and a note", recMl?.decision === "superseded" && recMl.replacedBy === ID.mlNew && typeof recMl.note === "string");
  ok("record array: old central task parked, KNN active", recArr?.find((x) => x.id === ID.centralOld)?.decision === "parked" && recArr?.find((x) => x.id === ID.mlKnn)?.decision === "active");
  ok("siblings of one sequence are not suggested as superseded (number guard)", recArr?.find((x) => x.id === ID.pmOld)?.decision === "parked" && recArr.filter((x) => x.decision === "superseded").length === 1);
  r = await call("sirius_triage", { action: "suggest", before: "2026-10-01" });
  const sugB = textOf(r);
  const jsonB = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(sugB)?.[1] ?? "[]");
  ok(
    "before mode: KNN, central old and PM old become superseded with the note",
    ["mlKnn", "centralOld", "pmOld"].every((k) => jsonB.find((x) => x.id === ID[k])?.decision === "superseded" && jsonB.find((x) => x.id === ID[k])?.note === "thuộc kế hoạch trước 2026-10-01") &&
      jsonB.find((x) => x.id === ID.centralNew)?.decision === "active",
  );
  r = await call("sirius_triage", { action: "suggest", before: "2026-13-45" });
  ok("suggest rejects a bad before date", r.isError === true);
  r = await call("sirius_triage", { action: "list" });
  ok("list with no decisions is empty and writes nothing", !r.isError && textOf(r).includes("Đang loại khỏi cảnh báo: 0 mục") && !existsSync(join(HUB, ".sirius")));

  /* ───────── 6. Today router on the Monday ───────── */
  section("today (Monday)");
  r = await call("sirius_today");
  const today = textOf(r);
  ok("today header", !r.isError && today.startsWith("# Hôm nay (2026-10-12, Thứ Hai)"));
  ok("deadline priority block first: urgent task and the P0 in 48 h", today.indexOf("## Ưu tiên hạn chót") > 0 && today.indexOf("## Ưu tiên hạn chót") < today.indexOf("## Lịch theo tuần mẫu") && today.includes("Nộp bài Python hôm nay") && today.includes("Nộp Attendance Survey Buổi 4") && today.includes("đứng trước tuần mẫu"));
  ok("today hints at the 13 untriaged overdue items", today.includes("còn 13 mục quá hạn chưa phân loại"));
  ok("weekly template for the phase and weekday", today.includes("## Lịch theo tuần mẫu (Giai đoạn I, Thứ Hai)"));
  ok("Python Master session of 60 minutes", /- Chính: Python Master, 60 phút/.test(today));
  ok("AMD session 30-60 kept as a label (unknown subject)", /- Phụ: AMD, 30-60 phút \(mẫu: "AMD \(30-60 phút\)"\); chưa nhận ra khóa này/.test(today));
  ok("plan warning for the unknown AMD label is reported", /không nhận ra khóa "AMD"/.test(today) && today.includes("## Ghi chú"));
  ok("weekly milestone per subject", today.includes("Mốc tuần 12/10-18/10: M0 chẩn đoán (13/10); M1"));
  ok("S1: polaris_today when polaris/schedule.json exists", today.includes(`Bước tiếp theo: polaris_today { subject_dir: "${fwdp(PM)}" }`));
  ok("Vega and Polaris due items (1 card, 1 step)", today.includes("Vega: 1 thẻ đến hạn trong ngày 2026-10-12 (Machine Learning 1)") && /Polaris \(Machine Learning\): .*\(hạn 2026-10-12\)/.test(today));
  ok("no commitments yet: template line", today.includes("Khi <giờ> ở <nơi>, mình sẽ <bước đầu tiên cụ thể> trong <N> phút. -> sirius_commit"));
  ok("E3: daily minimum line", today.includes("Mức tối thiểu hằng ngày: 25 phút (còn 25 phút)"));
  r = await call("sirius_today", { date: "2026-10-13" });
  const tue = textOf(r);
  ok("S1: Vega due beats Orion for Machine Learning (Tuesday)", tue.includes("Bước tiếp theo: vega_sync, rồi vega_session (1 thẻ đến hạn)"));
  ok("S1: Orion lab whose latest attempt failed -> orion_run (GCI, Tuesday)", tue.includes(`Bước tiếp theo: orion_run { lab: "${fwdp(LAB)}" }`));
  const noEv = runCli(["today", "2026-10-13"], { SIRIUS_EVIDENCE_DIRS: "" });
  ok("S1: otherwise the project's Next Action (GCI without labs)", noEv.code === 0 && noEv.out.includes("Bước tiếp theo: Hoàn thành Attendance Survey Buổi 4 trên Omnicampus."), noEv.out.split("\n").filter((l) => l.includes("Bước tiếp theo")).join(" | "));
  r = await call("sirius_today", { date: "2026-10-15" });
  ok("date with an empty template slot (Thursday GCI live 90 min)", textOf(r).includes("GCI World 2026, 90 phút"));
  r = await call("sirius_today", { date: "2026-12-30" });
  ok("date in phase III uses its template (Wednesday has none)", !r.isError && textOf(r).includes("Lịch theo tuần mẫu (Giai đoạn III"));
  r = await call("sirius_today", { date: "2026-08-01" });
  ok("date before the first phase says it is outside the plan", textOf(r).includes("nằm ngoài các giai đoạn"));

  /* ───────── 7. Week and stats on an empty journal ───────── */
  section("week and stats with no data");
  r = await call("sirius_week");
  const week0 = textOf(r);
  ok("week header with ISO label and dates", week0.startsWith("# Tổng kết tuần 2026-W42 (Thứ Hai 12/10 - Chủ Nhật 18/10)"));
  ok("E1: not enough weeks for the capacity measure", week0.includes("Chưa đủ dữ liệu: cần ít nhất 2 tuần có ghi phiên học."));
  r = await call("sirius_stats");
  ok("stats on an empty journal", !r.isError && textOf(r).includes("Chuỗi (cho phép bỏ 1 ngày lẻ): 0 ngày") && textOf(r).includes("Số ngày học trong 14 ngày qua: 0/14"));
  ok("read-only calls created nothing under .sirius", !existsSync(join(HUB, ".sirius")));

  /* ───────── 8. Triage record flows ───────── */
  section("triage record");
  const badId = ID.mlV1.slice(0, 9) + (ID.mlV1.endsWith("0") ? "1" : "0");
  r = await call("sirius_triage", { action: "record", decisions: [{ id: badId, decision: "parked" }] });
  ok("record with an unknown id errors and suggests the closest id", r.isError && textOf(r).includes("Gần nhất") && textOf(r).includes(ID.mlV1), textOf(r));
  r = await call("sirius_triage", { action: "record", decisions: [{ id: ID.mlKnn, decision: "snoozed", until: "2026-10-01" }] });
  ok("snoozed with a past until is rejected", r.isError && /đã qua/.test(textOf(r)), textOf(r));
  r = await call("sirius_triage", { action: "record", decisions: [{ id: ID.mlKnn, decision: "snoozed" }] });
  ok("snoozed without until is rejected", r.isError && /cần until/.test(textOf(r)));
  r = await call("sirius_triage", { action: "record", decisions: [{ id: ID.mlKnn, decision: "parked", replacedBy: ID.mlNew }] });
  ok("replacedBy only with superseded", r.isError && /replacedBy chỉ dùng với superseded/.test(textOf(r)));
  r = await call("sirius_triage", { action: "record", decisions: [{ id: ID.mlKnn, decision: "parked", replaced_by: ID.mlNew }] });
  ok("typo key is reported with the allowed keys", r.isError && /replacedBy/.test(textOf(r)), textOf(r));
  ok("failed record attempts wrote nothing", !existsSync(join(HUB, ".sirius")));

  r = await call("sirius_triage", {
    action: "record",
    decisions: [
      { id: ID.mlV1, decision: "superseded", replacedBy: ID.mlNew, note: "thay bởi M3.3a" },
      { id: ID.centralOld, decision: "parked" },
      { id: ID.mlKnn, decision: "snoozed", until: "2026-10-20", note: "làm sau Buổi 6" },
      { id: ID.centralNew, decision: "active" },
    ],
  });
  ok("valid record succeeds for 4 decisions", !r.isError && textOf(r).includes("Đã ghi 4 quyết định phân loại") && textOf(r).includes("Sirius không sửa bất kỳ tệp TASKS.md nào"), textOf(r));
  const GI = join(HUB, ".sirius", ".gitignore");
  ok("A4: .sirius/.gitignore exists with the exact content", existsSync(GI) && readFileSync(GI, "utf8").replace(/\r\n/g, "\n") === "# Created by Sirius: personal study data, never commit.\n*\n");
  if (hasGit) {
    const st = git(HUB, ["status", "--porcelain", "--ignored", ".sirius"]);
    ok("A4: git reports .sirius as ignored (!!) not untracked (??)", st.status === 0 && /^!! \.sirius\/$/m.test(st.stdout) && !/^\?\? /m.test(st.stdout), st.stdout.trim());
  }
  const jl = readJournalLines().map((l) => JSON.parse(l));
  ok("journal holds 4 triage records with raw and deadlineRaw", jl.length === 4 && jl.every((x) => x.type === "triage" && x.v === 1 && typeof x.raw === "string" && x.at === NOW_ISO));
  const recV1 = jl.find((x) => x.taskId === ID.mlV1);
  ok("journal triage record: superseded, replacedBy, file, line, raw, deadlineRaw", recV1?.decision === "superseded" && recV1.replacedBy === ID.mlNew && recV1.file === "Machine_Learning/TASKS.md" && recV1.line === LN.mlV1 && recV1.raw === ML_V1_LINE && recV1.deadlineRaw === "2026-09-26 23:59" && recV1.text.length <= 160);

  // A3: derived file for pick_today.py
  const TJ = join(HUB, ".sirius", "triage.json");
  ok("A3: triage.json exists and is pure ASCII", existsSync(TJ) && /^[\x00-\x7f]*$/.test(readFileSync(TJ, "utf8")));
  const tj = JSON.parse(readFileSync(TJ, "utf8"));
  ok("A3: triage.json shape {v, updated, entries}", tj.v === 1 && typeof tj.updated === "string" && Array.isArray(tj.entries));
  ok("A3: exactly the excluded decisions (superseded, parked, snoozed future), not 'active'", tj.entries.length === 3 && tj.entries.map((e) => e.decision).sort().join(",") === "parked,snoozed,superseded", tj.entries.map((e) => e.decision).join(","));
  const eV1 = tj.entries.find((e) => e.taskId === ID.mlV1);
  const eOld = tj.entries.find((e) => e.taskId === ID.centralOld);
  const eKnn = tj.entries.find((e) => e.taskId === ID.mlKnn);
  ok("A3: each raw equals the fixture line byte for byte (CRLF stripped)", eV1?.raw === ML_V1_LINE && eOld?.raw === CENTRAL_OLD_LINE && eKnn?.raw === ML_KNN_LINE);
  ok("A3: file relative with forward slashes, line, deadlineRaw, text, at", eV1?.file === "Machine_Learning/TASKS.md" && eV1.line === LN.mlV1 && eV1.deadlineRaw === "2026-09-26 23:59" && eV1.text === ML_V1_TEXT && eV1.at === NOW_ISO && eOld?.file === "TASKS.md");
  ok("A3: snoozed entry keeps until; superseded keeps replacedBy and note", eKnn?.until === "2026-10-20" && eKnn.note === "làm sau Buổi 6" && eV1?.replacedBy === ID.mlNew && eV1.note === "thay bởi M3.3a");
  ok("A3: merged copy (watchlist line) is listed under copies with its raw line", eV1?.copies?.length === 1 && eV1.copies[0].file === "ACTIVE_LEARNING.md" && eV1.copies[0].line === LN.alWatchMl && eV1.copies[0].raw === WATCH_ML_V1_LINE);

  r = await call("sirius_deadlines");
  dtext = textOf(r);
  ok("after record: 3 fewer overdue items and the classified section shows them", dtext.includes("## Quá hạn: 10 mục") && dtext.includes("## Đã phân loại (không cảnh báo): 3 mục") && dtext.includes("superseded") && dtext.includes("snoozed đến 2026-10-20"));
  ok("a decision on the kept id excludes the merged watchlist copy too", !dtext.includes("Ridge và Lasso") || dtext.indexOf("Ridge và Lasso") > dtext.indexOf("## Đã phân loại"));
  r = await call("sirius_triage", { action: "suggest" });
  ok("suggest no longer lists classified tasks", textOf(r).includes("Tổng: 10 việc quá hạn chưa phân loại") && !textOf(r).includes(`id ${ID.mlV1}`));
  r = await call("sirius_triage", { action: "list" });
  ok("list shows the decisions", textOf(r).includes("Đang loại khỏi cảnh báo: 3 mục") && textOf(r).includes("Đã ghi nhưng không loại khỏi cảnh báo: 1 mục") && textOf(r).includes(ID.mlV1));
  // inject an orphan decision and a garbage line directly into the journal (test side)
  appendFileSync(journalFile, JSON.stringify({ v: 1, type: "triage", at: NOW_ISO, taskId: "deadbeef00", decision: "parked", file: "Machine_Learning/TASKS.md", line: 99, text: "Dòng đã bị sửa" }) + "\nthis line is not json\n");
  r = await call("sirius_triage", { action: "list" });
  ok("orphaned decisions are reported", textOf(r).includes("Mồ côi: 1 mục") && textOf(r).includes("deadbeef00") && textOf(r).includes("1 dòng journal không hợp lệ"));
  const tjAfterOrphan = JSON.parse(readFileSync(TJ, "utf8"));
  ok("A3: orphans never appear in triage.json", tjAfterOrphan.entries.length === 3 && !tjAfterOrphan.entries.some((e) => e.taskId === "deadbeef00"));
  r = await call("sirius_deadlines");
  ok("invalid journal lines are counted and skipped", textOf(r).includes("1 dòng journal không hợp lệ đã bị bỏ qua"));

  // snooze expiry: the KNN task is back after its until date
  const later = runCli(["deadlines", "--json", "--now", "2026-10-21T09:00:00"]);
  const lj = JSON.parse(later.out);
  ok("snoozed task reappears after its until date", lj.buckets.overdue.some((i) => i.id === ID.mlKnn) && !lj.triagedItems.some((i) => i.id === ID.mlKnn));

  /* ───────── 9. Commitments, timer, logging ───────── */
  section("commit, start, stop, log");
  r = await call("sirius_commit", { subject: "Python Master", time: "08:00", action: "mở thư mục luyen_tap và giải bài 1", minutes: 25, where: "bàn học", now: T(12, 7, 30) });
  const commitText = textOf(r);
  const COMMIT_ID = /c_[0-9a-f]{8}/.exec(commitText)?.[0];
  ok("commit replies with the if-then sentence and the id", !r.isError && commitText.includes("Khi 08:00 ở bàn học, mình sẽ mở thư mục luyen_tap và giải bài 1 trong 25 phút.") && Boolean(COMMIT_ID), commitText);
  r = await call("sirius_commit", { subject: "Python Master", time: "08:00", action: "x", minutes: 3, now: T(12, 7, 30) });
  ok("commit with fewer than 5 minutes is rejected", r.isError === true);
  r = await call("sirius_commit", { subject: "Pyton Mastr", time: "08:00", action: "x", minutes: 10, now: T(12, 7, 30) });
  ok("commit with an unknown subject suggests the closest name", r.isError && textOf(r).includes("Python Master"));
  r = await call("sirius_commit", { subject: "PM", time: "25:99", action: "x", minutes: 10, now: T(12, 7, 30) });
  ok("commit with a bad time is rejected", r.isError && textOf(r).includes("HH:mm"));

  r = await call("sirius_start", { subject: "PM", estimate_minutes: 50, task: "giải bài 1", commit_id: COMMIT_ID, now: T(12, 8, 5) });
  ok("start (alias PM) writes the timer and reminds to call sirius_stop", !r.isError && textOf(r).includes("Đã bắt đầu phiên s_") && textOf(r).includes("sirius_stop") && existsSync(join(HUB, ".sirius", "active.json")));
  r = await call("sirius_start", { subject: "PM", estimate_minutes: 30, now: T(12, 8, 6) });
  ok("starting twice is an error that shows the running session", r.isError && textOf(r).includes("Đang có phiên chạy") && textOf(r).includes("Python Master"), textOf(r));
  r = await call("sirius_today", { now: T(12, 8, 20) });
  const t820 = textOf(r);
  ok("today shows the running timer and a kept commitment", t820.includes("## Đang chạy") && t820.includes("đã 15 phút / ước lượng 50 phút") && t820.includes("[đúng hẹn]"), t820);
  r = await call("sirius_stop", { outcome: "done", note: "xong bài 1", now: T(12, 8, 55) });
  const stopText = textOf(r);
  ok("stop: 50 minutes, ratio 1.0 and today's total", !r.isError && stopText.includes("50 phút") && stopText.includes("thực tế / ước lượng = 1.0") && stopText.includes("Hôm nay: 50 phút học, 0 phút meta, 1 phiên"), stopText);
  ok("active.json removed after stop", !existsSync(join(HUB, ".sirius", "active.json")));
  const sessionRec = readJournalLines().map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((x) => x?.type === "session");
  ok("journal session record: timer, 50 minutes, estimate 50, commitId, outcome done", sessionRec?.source === "timer" && sessionRec.minutes === 50 && sessionRec.estimate === 50 && sessionRec.commitId === COMMIT_ID && sessionRec.outcome === "done" && sessionRec.kind === "learn" && /^s_[0-9a-f]{8}$/.test(sessionRec.id) && sessionRec.note === "xong bài 1");
  r = await call("sirius_stop", { outcome: "done", now: T(12, 9, 0) });
  ok("stop without a running session is an error", r.isError && textOf(r).includes("Không có phiên nào đang chạy"));
  r = await call("sirius_start", { subject: "PM", estimate_minutes: 30, commit_id: "c_00000000", now: T(12, 9, 1) });
  ok("start with an unknown commit id is rejected and starts nothing", r.isError && textOf(r).includes("Không tìm thấy cam kết") && !existsSync(join(HUB, ".sirius", "active.json")));
  r = await call("sirius_today", { now: T(12, 9, 0) });
  ok("today after stop: kept commitment, 50 minutes learned, daily minimum reached (E3)", textOf(r).includes("[đúng hẹn]") && textOf(r).includes("Tổng: 50 phút học, 0 phút meta (1 phiên)") && textOf(r).includes("Mức tối thiểu hằng ngày: 25 phút (đã đạt)"));
  const dm60 = runCli(["today", "--now", T(12, 9, 0)], { SIRIUS_DAILY_MIN: "60" });
  ok("E3: SIRIUS_DAILY_MIN configures the minimum", dm60.out.includes("Mức tối thiểu hằng ngày: 60 phút (còn 10 phút)"), dm60.out.split("\n").filter((l) => l.includes("tối thiểu")).join("|"));

  const NOW_WED = T(14, 21, 0);
  r = await call("sirius_log", { subject: "ML", minutes: 75, outcome: "done", task: "đọc chương hồi quy", date: "2026-10-13", start_time: "09:00", now: NOW_WED });
  ok("log with date and start_time", !r.isError && textOf(r).includes("Đã ghi phiên s_") && textOf(r).includes("Machine Learning, 75 phút"), textOf(r));
  r = await call("sirius_log", { subject: "PM", minutes: 30, outcome: "done", date: "2026-10-13", now: NOW_WED });
  ok("log for another day without start_time is refused (no guessing)", r.isError && textOf(r).includes("start_time"));
  r = await call("sirius_log", { subject: "PM", minutes: 30, outcome: "done", start_time: "23:00", now: NOW_WED });
  ok("log that would end in the future is refused", r.isError && textOf(r).includes("sau thời điểm hiện tại"));
  r = await call("sirius_log", { subject: "hub", minutes: 10, outcome: "done", date: "2026-09-01", start_time: "20:00", now: NOW_WED });
  ok("hub subject logged as learn gets the meta hint", textOf(r).includes('kind: "meta"'));
  r = await call("sirius_log", { subject: "GCI", minutes: 40, outcome: "done", start_time: "19:00", now: NOW_WED });
  ok("log without date defaults to today (Wednesday) with start_time", !r.isError && textOf(r).includes("GCI World 2026, 40 phút"));
  r = await call("sirius_log", { subject: "hub", minutes: 30, outcome: "done", kind: "meta", start_time: "11:00", now: NOW_WED });
  ok("meta session logged", !r.isError && textOf(r).includes("meta"));

  /* ───────── 10. Weekly review, first pass (too few samples) ───────── */
  section("week review, first pass");
  const gitOk = hasGit;
  // The Rigel parts come right after Mira (see the activity.jsonl fixture): GCI 3 questions + 5 cards, ML 2 questions, PM 1 question.
  const evStudyGCI = "Hỏi đáp có nguồn 3 (mạnh 1, yếu 1, không 1), Thẻ từ tài liệu 5";
  const evStudyML = "Hỏi đáp có nguồn 2 (mạnh 1, yếu 1, không 0)";
  const evStudyPM = "Hỏi đáp có nguồn 1 (mạnh 1, yếu 0, không 0)";
  const evML = `Vega 2 lượt ôn, ${evStudyML}, Sổ lỗi 1, Ôn Polaris 1${gitOk ? ", commit 2" : ""}`;
  const evGCI = `Orion 2 lần chạy, Aurora 2 sự kiện, Mira dò code 2/3 đúng, ${evStudyGCI}`;
  const evPM = gitOk ? `${evStudyPM}, commit 1` : evStudyPM;
  r = await call("sirius_week", { now: NOW_WED });
  const w1 = textOf(r);
  ok("week: header, label and dates", !r.isError && w1.startsWith("# Tổng kết tuần 2026-W42 (Thứ Hai 12/10 - Chủ Nhật 18/10)"));
  ok("week summary: study hours versus the budget of the phase", w1.includes("- Học: 2,8 giờ (165 phút) so với ngân sách 10,5-12,5 giờ (Giai đoạn I)."), w1.split("\n").find((l) => l.startsWith("- Học")));
  ok("week summary: meta, study days, commitments", w1.includes("- Meta (kế hoạch, công cụ): 0,5 giờ (30 phút).") && w1.includes("- Số ngày có học: 3/7.") && w1.includes("- Cam kết: đúng hẹn 1, trễ 0, bỏ lỡ 0, chưa tới giờ 0."));
  ok("week table header", w1.includes("| Khóa | Kế hoạch (giờ) | Thực tế (giờ) | Phiên | Bằng chứng | Hạn trong tuần | Trạng thái |"));
  ok("week row GCI: plan range, actual, Orion + Aurora + Mira evidence", w1.includes(`| GCI World 2026 | 5-6,5 | ${fmtVi1(40 / 60)} | 1 | ${evGCI} | 0/1 | Hụt nhịp |`), w1.split("\n").find((l) => l.startsWith("| GCI World")));
  ok("week row Machine Learning: Vega 2, error log 1, Polaris review 1, commits 2", w1.includes(`| Machine Learning | 3 | ${fmtVi1(75 / 60)} | 1 | ${evML} | 1/1 | Hụt nhịp |`), w1.split("\n").find((l) => l.startsWith("| Machine Learning")));
  ok("week row Python Master: nested repo commit", w1.includes(`| Python Master | 2,5-3 | ${fmtVi1(50 / 60)} | 1 | ${evPM} | 0/2 | Hụt nhịp |`), w1.split("\n").find((l) => l.startsWith("| Python Master")));
  ok("week has a total row and no hub row without study", w1.includes("| **Tổng** | 10,5-12,5 |") && !w1.includes("| Hub / Hạ tầng |"));
  ok("S2: Mira events are counted separately and kept out of the generic Aurora count", w1.includes("Mira dò code 2/3 đúng") && w1.includes("Aurora 2 sự kiện") && !w1.includes("Aurora 5 sự kiện"));
  ok("plan per day versus actual (Monday and Tuesday)", w1.includes("| Thứ Hai 12/10 | Python Master 60; AMD 30-60 | Python Master 50 |") && w1.includes("| Thứ Ba 13/10 | Machine Learning 70; GCI World 2026 30 | Machine Learning 75 |"));
  ok("plan per day: clock range, alternatives and review", w1.includes("| Thứ Năm 15/10 | GCI World 2026 90 | - |") && w1.includes("Machine Learning hoặc GCI World 2026 60; Ôn xuyên khóa 20"));
  ok("E1: capacity needs 2 weeks; estimate section needs 3 samples", w1.includes("Chưa đủ dữ liệu: cần ít nhất 2 tuần có ghi phiên học.") && w1.includes("Chưa đủ dữ liệu (cần ít nhất 3 phiên có ước lượng)."));
  ok("week notes say SmartDrive is off", w1.includes("## Ghi chú nguồn dữ liệu") && w1.includes("SmartDrive đang tắt"));
  ok(
    "Rigel: the 'Học và hạ tầng' section counts the activity as study evidence (7 questions, 7 cards, 1 note, khác included)",
    w1.includes("\n- Hỏi đáp có nguồn (Rigel): 7 câu hỏi (mạnh 3, yếu 2, không 2), 7 thẻ từ tài liệu, 1 ghi chú đã lưu. Tính là bằng chứng học.\n"),
    w1.split("\n").find((l) => l.includes("Rigel")),
  );
  const rowOf = (txt, name) => txt.split("\n").find((l) => l.startsWith(`| ${name} |`)) ?? "";
  ok(
    "Rigel: the 'Bằng chứng' column drops zeros (no cards row without 'Thẻ từ tài liệu') and leaves saved notes to the section line",
    rowOf(w1, "GCI World 2026").includes("Thẻ từ tài liệu 5") &&
      !rowOf(w1, "Machine Learning").includes("Thẻ từ tài liệu") &&
      !rowOf(w1, "Python Master").includes("Thẻ từ tài liệu") &&
      !w1.includes("Thẻ từ tài liệu 0") &&
      !w1.includes("Hỏi đáp có nguồn 0") &&
      !w1.includes("Ghi chú đã lưu"),
  );
  ok(
    "Rigel: calls that match no subject go to khác with one note naming the labels; uncounted tools stay silent",
    w1.split("\n").filter((l) => l.startsWith("- Rigel: 2 lần gọi không gắn được với khóa nào")).length === 1 &&
      w1.includes('"Zeta Course"') &&
      w1.includes('"Ghost_Subject"') &&
      w1.includes('mục "khác"') &&
      !w1.includes("Silent Course"),
    w1.split("\n").find((l) => l.includes("Rigel:")),
  );
  ok("Rigel: no table row for khác, and no Rigel note about the log itself", !w1.includes("| khác |") && !w1.includes("| Khác") && w1.split("\n").filter((l) => l.startsWith("- Rigel:")).length === 1);

  /* ───────── 11. Estimates, history, second pass, write ───────── */
  section("week review, second pass (estimates, capacity, share summary, write)");
  const logOk = async (a, name) => {
    const x = await call("sirius_log", { now: NOW_WED, outcome: "done", ...a });
    ok(name, !x.isError, textOf(x).split("\n")[0]);
  };
  await logOk({ subject: "ML", minutes: 90, estimate_minutes: 60, date: "2026-10-13", start_time: "14:00" }, "log ML 90 min (estimate 60)");
  await logOk({ subject: "ML", minutes: 45, estimate_minutes: 30, date: "2026-10-13", start_time: "16:00" }, "log ML 45 min (estimate 30)");
  await logOk({ subject: "ML", minutes: 60, estimate_minutes: 40, date: "2026-10-14", start_time: "10:00" }, "log ML 60 min (estimate 40)");
  await logOk({ subject: "ML", minutes: 120, date: "2026-09-22", start_time: "09:00" }, "history W39: ML 120");
  await logOk({ subject: "ML", minutes: 150, date: "2026-09-29", start_time: "09:00" }, "history W40: ML 150");
  await logOk({ subject: "GCI", minutes: 90, date: "2026-10-01", start_time: "19:00" }, "history W40: GCI 90");
  await logOk({ subject: "ML", minutes: 120, date: "2026-10-06", start_time: "09:00" }, "history W41: ML 120");
  await logOk({ subject: "PM", minutes: 60, date: "2026-10-08", start_time: "20:00" }, "history W41: PM 60");

  r = await call("sirius_week", { now: NOW_WED });
  const w2 = textOf(r);
  ok("study total 360 minutes = 6 hours", w2.includes("- Học: 6 giờ (360 phút) so với ngân sách 10,5-12,5 giờ (Giai đoạn I)."), w2.split("\n").find((l) => l.startsWith("- Học")));
  ok("ML row after the estimate logs: 4,5 hours, 4 sessions, on pace", w2.includes(`| Machine Learning | 3 | ${fmtVi1(270 / 60)} | 4 | ${evML} | 1/1 | Đúng nhịp |`), w2.split("\n").find((l) => l.startsWith("| Machine Learning")));
  ok("estimates: overall median 1,5 over 4 samples", w2.includes("Tổng thể bạn thường mất 1,5 lần thời gian ước lượng (4 phiên): nhân ước lượng với 1,5."));
  ok("estimates: per-subject sentence for Machine Learning", w2.includes("Bạn thường mất 1,5 lần thời gian ước lượng cho Machine Learning: nhân ước lượng với 1,5."));
  ok("estimates: subjects with fewer than 3 samples get no sentence", !w2.includes("ước lượng cho Python Master"));
  ok("E1: capacity is the median of the last 3 completed weeks with sessions", w2.includes("Năng lực thực tế: 3 giờ/tuần (trung vị của 3 tuần gần nhất có ghi phiên học: 2026-W39, 2026-W40, 2026-W41)."), w2.split("\n").find((l) => l.includes("Năng lực")));
  ok("E1: budget minimum 10,5 h is 3,5 times the measured capacity", w2.includes("Kế hoạch đang gấp 3,5 lần năng lực đã đo; nên cắt phạm vi theo nguyên tắc 7 thay vì học dồn."));
  ok("deadlines: due in week and untriaged overdue count", w2.includes("- Việc có hạn trong tuần: 1/4 đã xong, 3 chưa xong.") && w2.includes("- Hiện đang quá hạn chưa phân loại: 13 mục."));
  ok("principle 7 names the course and the task late by more than 2 weeks", w2.includes('Nguyên tắc 7 (cắt phạm vi): Python Master trễ hơn 2 tuần ở "Hoàn thành chuyên đề Chuỗi và Mảng 1 chiều.": bỏ phần Thử thách và dời lịch của khóa này, không học dồn.'), w2.split("\n").filter((l) => l.includes("Nguyên tắc 7")).join("|"));
  ok("principle 7 skips triaged tasks (Machine Learning, central)", w2.split("\n").filter((l) => l.includes("Nguyên tắc 7")).length === 1);
  ok("study vs infrastructure: counts and no tooling warning yet", w2.includes("- Thời gian: học 360 phút, meta 30 phút.") && (!gitOk || w2.includes("- Commit: 3 trong thư mục các khóa, 3 trong repo công cụ.")) && !w2.includes("Tuần này thời gian làm công cụ nhiều hơn thời gian học."));
  ok("Sunday ritual: error log link, both milestones, the prompt", w2.includes("Sổ lỗi có mục mới trong tuần:") && /errorlog\.md\]\(file:\/\/\/.+polaris\/errorlog\.md\)/.test(w2) && w2.includes("Mốc tuần này (12/10-18/10):") && w2.includes("Mốc tuần sau (19/10-25/10):") && w2.includes("Chọn 3 việc quan trọng nhất cho tuần tới."));
  const shareStart = w2.indexOf("## Bản tóm tắt để chia sẻ");
  const shareLines = w2.slice(shareStart).split("\n").slice(1).filter((l) => l.trim());
  ok("E4: shareable summary is the last section with at most 5 plain lines", shareStart > w2.indexOf("## Ghi chú nguồn dữ liệu") && shareLines.length >= 4 && shareLines.length <= 5, String(shareLines.length));
  ok("E4: summary lines (hours vs budget, days, commitments, top missed deadline, next-week prompt)", shareLines[0] === "Giờ học: 6 giờ so với ngân sách 10,5-12,5 giờ." && shareLines[1] === "Số ngày có học: 3/7." && shareLines[2] === "Cam kết giữ đúng hẹn: 1/1." && shareLines[3].startsWith("Hạn lỡ nổi bật: Nộp Attendance Survey Buổi 4") && shareLines[shareLines.length - 1] === "Tuần tới: 3 việc quan trọng nhất: ...(tự điền)", shareLines.join(" | "));
  ok("E4: no personal file paths in the summary", !/file:\/\/\/|[A-Za-z]:[\\/]|sirius_e2e|TASKS\.md|\.md/.test(shareLines.join("\n")));

  // tooling-heavy sentence: a long meta session
  await logOk({ subject: "hub", minutes: 400, kind: "meta", date: "2026-10-13", start_time: "10:00" }, "log 400 minutes of meta work (Tuesday)");
  r = await call("sirius_week", { now: NOW_WED });
  ok("meta minutes above study minutes: the tooling sentence appears", textOf(r).includes("Tuần này thời gian làm công cụ nhiều hơn thời gian học.") && textOf(r).includes("meta 430 phút"));

  // write: the only file Sirius writes outside .sirius/
  const WR = join(HUB, "Roadmaps", "weekly_reviews", "2026-W42.md");
  ok("week without write does not create the review file", !existsSync(WR));
  r = await call("sirius_week", { now: NOW_WED, write: true });
  const wtext = textOf(r);
  ok("week write: true creates Roadmaps/weekly_reviews/2026-W42.md and says so", !r.isError && existsSync(WR) && wtext.includes("Đã ghi bản tổng kết tuần vào:") && wtext.includes("weekly_reviews"));
  ok("the review file holds the report", existsSync(WR) && readFileSync(WR, "utf8") === wtext.split("\n\nĐã ghi bản tổng kết tuần vào:")[0] + "\n");
  const wrText = existsSync(WR) ? readFileSync(WR, "utf8") : "";
  ok(
    "Rigel: the written review carries the study evidence and none of the logged query text",
    wrText.includes(evStudyGCI) && wrText.includes("- Hỏi đáp có nguồn (Rigel): 7 câu hỏi") && !wrText.includes(STUDY_MARK),
  );
  r = await call("sirius_week", { now: NOW_WED, week: "2026-10-14", write: true });
  ok("writing the same week again overwrites the same file", !r.isError && readdirSync(join(HUB, "Roadmaps", "weekly_reviews")).length === 1);
  r = await call("sirius_week", { week: "not-a-date" });
  ok("week rejects a bad date", r.isError === true);
  r = await call("sirius_week", { now: NOW_WED, week: "2026-07-01" });
  ok("a week outside the plan has no budget but still reports", !r.isError && textOf(r).includes("không có ngân sách giờ cho tuần này"));

  /* ───────── 12. Stats and the tolerant streak ───────── */
  section("stats");
  const NOW_SAT = T(17, 21, 0);
  await call("sirius_log", { subject: "PM", minutes: 30, outcome: "done", date: "2026-10-16", start_time: "20:00", now: NOW_SAT });
  r = await call("sirius_stats", { now: NOW_SAT });
  const st = textOf(r);
  ok("stats: weekly table", !r.isError && st.includes("## Theo tuần (4 tuần gần nhất)") && st.includes("| Tuần | Học (phút) | Theo khóa (phút) | Meta (phút) | Ngày học |"));
  ok("E2: a single-day gap keeps the streak (4 study days in 5 days)", st.includes("Chuỗi (cho phép bỏ 1 ngày lẻ): 4 ngày học trong 5 ngày liên tục (hôm nay chưa có phiên đủ 10 phút)."), st.split("\n").find((l) => l.includes("Chuỗi")));
  ok("E2: study days in the last 14 days", st.includes("Số ngày học trong 14 ngày qua: 6/14"));
  ok("E1: capacity in stats with the over-budget sentence", st.includes("Năng lực thực tế: 3 giờ/tuần") && st.includes("Kế hoạch đang gấp 3,5 lần năng lực đã đo"));
  ok("stats: estimate ratio and commitment keep rate", st.includes("Tổng thể bạn thường mất 1,5 lần") && st.includes("Tỉ lệ giữ cam kết: 100%"));
  ok(
    "Rigel stats: optional weekly table of grounded questions and cards (W41: 1, W42: 7 with the coverage split and 7 cards)",
    st.includes("## Hỏi đáp có nguồn theo tuần (Rigel)") &&
      st.includes("| Tuần | Hỏi đáp có nguồn | Thẻ từ tài liệu |") &&
      st.includes("| 2026-W39 (21/09-27/09) | 0 | 0 |") &&
      st.includes("| 2026-W41 (05/10-11/10) | 1 (mạnh 1, yếu 0, không 0) | 0 |") &&
      st.includes("| 2026-W42 (12/10-18/10) | 7 (mạnh 3, yếu 2, không 2) | 7 |") &&
      st.indexOf("## Hỏi đáp có nguồn theo tuần") > st.indexOf("## Theo tuần") &&
      st.indexOf("## Hỏi đáp có nguồn theo tuần") < st.indexOf("## Chuỗi ngày học"),
    st.split("\n").filter((l) => l.includes("2026-W4")).join(" | "),
  );
  const sj = JSON.parse(runCli(["stats", "--json", "--weeks", "4", "--now", NOW_SAT]).out);
  ok(
    "Rigel stats --json: every week row carries its study counts",
    sj.weeks.map((x) => x.study.questions).join(",") === "0,0,1,7" && sj.weeks[3].study.cards === 7 && sj.weeks[3].study.notes === 1 && sj.weeks[2].study.strong === 1 && Array.isArray(sj.notes) && sj.notes.length === 0,
    JSON.stringify(sj.weeks.map((x) => x.study)),
  );
  ok(
    "stats --json: week rows W39..W42 with study and meta minutes",
    sj.weeks.length === 4 && sj.weeks.map((x) => x.label).join(",") === "2026-W39,2026-W40,2026-W41,2026-W42" && sj.weeks.map((x) => x.studyMinutes).join(",") === "120,240,180,390" && sj.weeks[3].metaMinutes === 430 && sj.weeks[3].studyDays === 4,
    sj.weeks.map((x) => `${x.label}:${x.studyMinutes}/${x.metaMinutes}`).join(" "),
  );
  ok("stats --json: streak 4 over 5 days, last14 6, capacity median 3 from 3 weeks, keep rate 1", sj.streak.streak === 4 && sj.streak.spanDays === 5 && sj.streak.last14 === 6 && sj.capacity.medianHours === 3 && sj.capacity.weeksUsed === 3 && sj.commitments.keepRate === 1);
  const NOW_MON19 = T(19, 21, 0);
  await call("sirius_log", { subject: "PM", minutes: 30, outcome: "done", date: "2026-10-19", start_time: "20:00", now: NOW_MON19 });
  const sj2 = JSON.parse(runCli(["stats", "--json", "--weeks", "4", "--now", NOW_MON19]).out);
  ok("E2: a two-day gap (Saturday, Sunday) breaks the streak", sj2.streak.streak === 1 && sj2.streak.spanDays === 1 && sj2.streak.todayCounts === true && sj2.streak.last14 === 7, JSON.stringify(sj2.streak));
  ok(
    "Rigel stats: the current week (W43) counts only its own line; the window slides with --now",
    sj2.weeks.map((x) => x.study.questions).join(",") === "0,1,7,1" && sj2.weeks[3].study.weak === 1,
    JSON.stringify(sj2.weeks.map((x) => x.study.questions)),
  );
  r = await call("sirius_stats", { now: NOW_MON19, weeks: 26 });
  ok("stats accepts up to 26 weeks", !r.isError && textOf(r).includes("## Theo tuần (26 tuần gần nhất)"));
  r = await call("sirius_stats", { weeks: 27 });
  ok("stats rejects more than 26 weeks", r.isError === true);

  /* ───────── 12b. Rigel evidence: counts, folders, bounds, silence ───────── */
  section("Rigel evidence");
  const studyWeek = (week, extraEnv = {}, removeEnv = []) => {
    const x = runCli(["week", week, "--json", "--now", NOW_WED], extraEnv, removeEnv);
    let j;
    try {
      j = JSON.parse(x.out);
    } catch {
      j = undefined;
    }
    return { code: x.code, err: x.err, j, by: j?.evidence?.study?.bySubject ?? {}, notes: j?.notes ?? [] };
  };
  const sx = (s) => (s ? [s.questions, s.strong, s.weak, s.none, s.cards, s.notes].join("/") : "-"); // questions/strong/weak/none/cards/notes
  const GCI_KEY = "GCI_World_2026_September";
  const w42 = studyWeek("2026-10-12");
  ok(
    "week JSON W42 per subject (questions/strong/weak/none/cards/notes): GCI 3/1/1/1/5/0, ML 2/1/1/0/0/1, PM 1/1/0/0/0/0, khác 1/0/0/1/2/0",
    w42.code === 0 && sx(w42.by[GCI_KEY]) === "3/1/1/1/5/0" && sx(w42.by.Machine_Learning) === "2/1/1/0/0/1" && sx(w42.by.Python_Master) === "1/1/0/0/0/0" && sx(w42.by["khác"]) === "1/0/0/1/2/0" && Object.keys(w42.by).length === 4,
    JSON.stringify(w42.by),
  );
  ok(
    "bad lines (not JSON, bad or missing timestamp, other version, unknown tool, blank) are skipped silently: the report still builds and its only Rigel note is the khác one",
    w42.code === 0 && w42.notes.filter((n) => n.startsWith("Rigel:")).length === 1 && w42.notes.find((n) => n.startsWith("Rigel:"))?.includes("2 lần gọi"),
    w42.notes.join(" | "),
  );
  ok("week JSON infrastructure.studyEvidence holds the totals 7/3/2/2/7/1", sx(w42.j?.infrastructure?.studyEvidence) === "7/3/2/2/7/1", JSON.stringify(w42.j?.infrastructure?.studyEvidence));
  const w41 = studyWeek("2026-10-06");
  const w43 = studyWeek("2026-10-19");
  ok(
    "lines outside the week belong to their own weeks (W41: 1 GCI question; W43: 1 ML question)",
    sx(w41.by[GCI_KEY]) === "1/1/0/0/0/0" && Object.keys(w41.by).join() === GCI_KEY && sx(w43.by.Machine_Learning) === "1/0/1/0/0/0" && Object.keys(w43.by).join() === "Machine_Learning",
    JSON.stringify([w41.by, w43.by]),
  );
  const wAlt = studyWeek("2026-10-12", { SIRIUS_RIGEL_HOME: STUDY_ALT });
  ok("SIRIUS_RIGEL_HOME selects the folder", sx(wAlt.by[GCI_KEY]) === "1/1/0/0/0/1" && Object.keys(wAlt.by).length === 1 && wAlt.notes.every((n) => !n.includes("Rigel")), JSON.stringify(wAlt.by));
  const wBoth = studyWeek("2026-10-12", { SIRIUS_RIGEL_HOME: STUDY_HOME, RIGEL_HOME: STUDY_ALT });
  ok("SIRIUS_RIGEL_HOME wins over RIGEL_HOME", sx(wBoth.by[GCI_KEY]) === "3/1/1/1/5/0" && Object.keys(wBoth.by).length === 4, JSON.stringify(wBoth.by));
  const wLegacy = studyWeek("2026-10-12", { RIGEL_HOME: STUDY_ALT }, ["SIRIUS_RIGEL_HOME"]);
  ok("RIGEL_HOME is used when SIRIUS_RIGEL_HOME is not set", sx(wLegacy.by[GCI_KEY]) === "1/1/0/0/0/1" && Object.keys(wLegacy.by).length === 1, JSON.stringify(wLegacy.by));
  const wHome = studyWeek("2026-10-12", { USERPROFILE: FAKE_HOME, HOME: FAKE_HOME }, ["SIRIUS_RIGEL_HOME"]);
  ok("with no variable the default is <home>/.rigel/activity.jsonl", sx(wHome.by.Python_Master) === "0/0/0/0/3/0" && Object.keys(wHome.by).length === 1, JSON.stringify(wHome.by));
  const wNoHome = studyWeek("2026-10-12", { USERPROFILE: EMPTY_HOME, HOME: EMPTY_HOME }, ["SIRIUS_RIGEL_HOME"]);
  ok(
    "no variable and no <home>/.rigel: skipped silently (no data, no note, nothing created)",
    wNoHome.code === 0 && Object.keys(wNoHome.by).length === 0 && wNoHome.notes.every((n) => !n.includes("Rigel")) && readdirSync(EMPTY_HOME).length === 0 && sx(wNoHome.j?.infrastructure?.studyEvidence) === "0/0/0/0/0/0",
    wNoHome.notes.join(" | ") + wNoHome.err,
  );
  const wEmptyDir = studyWeek("2026-10-12", { SIRIUS_RIGEL_HOME: STUDY_EMPTY });
  const emptyText = runCli(["week", "2026-10-12", "--now", NOW_WED], { SIRIUS_RIGEL_HOME: STUDY_EMPTY }).out;
  ok(
    "an existing folder without activity.jsonl is skipped silently; the report has no study line",
    wEmptyDir.code === 0 && Object.keys(wEmptyDir.by).length === 0 && wEmptyDir.notes.every((n) => !n.includes("Rigel")) && !emptyText.includes("Hỏi đáp có nguồn") && !emptyText.includes("Thẻ từ tài liệu") && readdirSync(STUDY_EMPTY).length === 0,
    wEmptyDir.notes.join(" | "),
  );
  const wMissing = studyWeek("2026-10-12", { SIRIUS_RIGEL_HOME: STUDY_MISSING });
  const missingNotes = wMissing.notes.filter((n) => n.startsWith("Rigel:"));
  ok(
    "SIRIUS_RIGEL_HOME pointing to a missing folder: no data, exactly one note naming the variable, the folder is not created",
    wMissing.code === 0 && Object.keys(wMissing.by).length === 0 && missingNotes.length === 1 && missingNotes[0].includes("SIRIUS_RIGEL_HOME trỏ tới thư mục không tồn tại") && !existsSync(STUDY_MISSING),
    missingNotes.join(" | "),
  );
  const wMissing2 = studyWeek("2026-10-12", { RIGEL_HOME: STUDY_MISSING }, ["SIRIUS_RIGEL_HOME"]);
  ok("the missing-folder note names RIGEL_HOME when that is the variable in use", wMissing2.notes.some((n) => n.startsWith("Rigel: RIGEL_HOME trỏ tới thư mục không tồn tại")), wMissing2.notes.join(" | "));
  const bigSize = statSync(join(STUDY_BIG, "activity.jsonl")).size;
  const wBig = studyWeek("2026-10-12", { SIRIUS_RIGEL_HOME: STUDY_BIG });
  ok(
    "a log above 4 MB is read from its end only: the note says so and the newest lines are counted",
    bigSize > 4 * 1024 * 1024 && wBig.notes.includes("Rigel: activity.jsonl lớn, chỉ đọc phần cuối.") && sx(wBig.by[GCI_KEY]) === "1/1/0/0/4/0" && Object.keys(wBig.by).length === 1,
    `${bigSize} bytes; ${JSON.stringify(wBig.by)}; ${wBig.notes.join(" | ")}`,
  );
  const wDirLog = studyWeek("2026-10-12", { SIRIUS_RIGEL_HOME: STUDY_DIRLOG });
  ok(
    "a log that cannot be read (a folder in its place) gives one note, no data and no crash",
    wDirLog.code === 0 && Object.keys(wDirLog.by).length === 0 && wDirLog.notes.some((n) => n.startsWith("Rigel: không đọc được")),
    wDirLog.notes.join(" | "),
  );
  const stEmpty = runCli(["stats", "--now", NOW_SAT], { SIRIUS_RIGEL_HOME: STUDY_EMPTY });
  ok("stats without Rigel activity has no study section and no study note", stEmpty.code === 0 && !stEmpty.out.includes("Hỏi đáp có nguồn") && !stEmpty.out.includes("Rigel"), stEmpty.err);
  const stMissing = runCli(["stats", "--now", NOW_SAT], { SIRIUS_RIGEL_HOME: STUDY_MISSING });
  ok(
    "stats with SIRIUS_RIGEL_HOME pointing to a missing folder shows the same note and no study section",
    stMissing.code === 0 && stMissing.out.includes("Ghi chú: Rigel: SIRIUS_RIGEL_HOME trỏ tới thư mục không tồn tại") && !stMissing.out.includes("Hỏi đáp có nguồn theo tuần"),
    stMissing.err,
  );
  const stJson = JSON.parse(runCli(["stats", "--json", "--weeks", "2", "--now", NOW_SAT], { SIRIUS_RIGEL_HOME: STUDY_ALT }).out);
  ok("stats --json with another study folder counts that folder (W42: 1 question, 1 note)", stJson.weeks[1].study.questions === 1 && stJson.weeks[1].study.notes === 1 && stJson.weeks[0].study.questions === 0, JSON.stringify(stJson.weeks.map((x) => x.study)));
  const tCli = runCli(["today", "2026-10-13"], { SIRIUS_RIGEL_HOME: STUDY_MISSING });
  ok("the Rigel source does not touch sirius_today or deadlines", tCli.code === 0 && !tCli.out.includes("Rigel") && !runCli(["deadlines"], { SIRIUS_RIGEL_HOME: STUDY_MISSING }).out.includes("Rigel"));

  /* ───────── 13. CLI ───────── */
  section("CLI");
  const help = runCli(["help"]);
  ok("CLI help lists the commands", help.code === 0 && ["deadlines", "today", "triage suggest", "triage record <json-or-file>", "commit <subject>", "start <subject>", "stop <done", "log <subject>", "week", "stats", "guide", "--hub", "--now", "--json"].every((s) => help.out.includes(s)));
  ok("CLI version prints 0.1.1", runCli(["version"]).out.trim() === "0.1.1");
  ok("CLI --version and -v work", runCli(["--version"]).out.trim() === "0.1.1" && runCli(["-v"]).out.trim() === "0.1.1");
  const pkgVersion = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
  ok("package.json, the bundle VERSION and the CLI agree on 0.1.1", pkgVersion === "0.1.1" && lib.VERSION === "0.1.1" && lib.VERSION === runCli(["version"]).out.trim(), `${pkgVersion} / ${lib.VERSION}`);
  const tcli = runCli(["today", "2026-10-13"]);
  ok("CLI today prints the router for a date", tcli.code === 0 && tcli.out.startsWith("# Hôm nay (2026-10-13, Thứ Ba)"));
  const wj = runCli(["week", "2026-10-12", "--json", "--now", NOW_MON19]);
  let wjson;
  try {
    wjson = JSON.parse(wj.out);
  } catch {
    wjson = undefined;
  }
  ok("CLI week --json parses with label, summary, subjects, share summary", wj.code === 0 && wjson?.week?.label === "2026-W42" && Array.isArray(wjson.subjects) && wjson.summary.studyMinutes === 390 && wjson.shareSummary.length <= 5);
  ok("CLI guide topic prints the guide (and --json)", runCli(["guide", "triage"]).out.includes("Phân loại việc quá hạn") && JSON.parse(runCli(["guide", "plan", "--json"]).out).topic === "plan");
  ok("CLI unknown command exits 1", runCli(["nonsense"]).code === 1);
  ok("CLI missing args exit 1 with usage", (() => { const x = runCli(["commit", "PM"]); return x.code === 1 && x.err.includes("Usage"); })());
  ok("CLI bad flag exits 1", (() => { const x = runCli(["deadlines", "--bogus"]); return x.code === 1 && x.err.includes("Cờ không hợp lệ"); })());
  ok("CLI error for an unknown subject exits 1 with a hint", (() => { const x = runCli(["deadlines", "--subject", "Pyton"]); return x.code === 1 && x.err.includes("Python Master"); })());

  // CLI round trip (far future so the earlier checks are unaffected)
  const cc = runCli(["commit", "Python Master", "08:00", "25", "mở", "file", "làm", "bài", "5", "--where", "bàn học", "--date", "2026-11-30", "--now", "2026-11-30T07:30:00"]);
  const cid = /c_[0-9a-f]{8}/.exec(cc.out)?.[0];
  ok("CLI commit (same day: no date in the sentence)", cc.code === 0 && Boolean(cid) && cc.out.includes("Khi 08:00 ở bàn học, mình sẽ mở file làm bài 5 trong 25 phút."), cc.out + cc.err);
  const cc2 = runCli(["commit", "PM", "19:30", "40", "ôn", "lại", "bài", "5", "--date", "2026-12-01", "--now", "2026-11-30T07:30:00"]);
  ok("CLI commit for another day names the date", cc2.code === 0 && cc2.out.includes("Khi 19:30 ngày 2026-12-01, mình sẽ ôn lại bài 5 trong 40 phút."), cc2.out + cc2.err);
  const cs = runCli(["start", "PM", "30", "giải", "bài", "5", "--kind", "practice", "--commit", cid, "--now", "2026-11-30T08:02:00"]);
  ok("CLI start", cs.code === 0 && cs.out.includes("Đã bắt đầu phiên"), cs.out + cs.err);
  const cx = runCli(["stop", "partial", "còn", "dở", "--minutes", "28", "--now", "2026-11-30T08:40:00"]);
  ok("CLI stop with a minutes override", cx.code === 0 && cx.out.includes("28 phút") && cx.out.includes("thực tế / ước lượng = 0.9"), cx.out + cx.err);
  const cl = runCli(["log", "GCI", "20", "done", "xem", "lại", "notebook", "--kind", "review", "--estimate", "25", "--start", "18:00", "--date", "2026-11-30", "--now", "2026-11-30T21:00:00"]);
  ok("CLI log", cl.code === 0 && cl.out.includes("20 phút (ôn tập, hoàn thành)"), cl.out + cl.err);
  const decFile = join(TEST_DIR, "decisions.json");
  writeFileSync(decFile, JSON.stringify([{ id: ID.pmOld, decision: "parked", note: "gác theo lộ trình v2" }]), "utf8");
  const ct = runCli(["triage", "record", decFile]);
  ok("CLI triage record from a JSON file", ct.code === 0 && ct.out.includes("Đã ghi 1 quyết định phân loại"), ct.out + ct.err);
  const ct2 = runCli(["triage", "record", JSON.stringify([{ id: ID.centralNew, decision: "snoozed" }])]);
  ok("CLI triage record from inline JSON validates (snoozed needs until)", ct2.code === 1 && ct2.err.includes("cần until"), ct2.err);

  // forgotten timer (kept for last: it adds an estimate sample)
  r = await call("sirius_start", { subject: "GCI", estimate_minutes: 30, kind: "practice", now: "2026-11-02T06:00:00" });
  r = await call("sirius_stop", { outcome: "partial", now: "2026-11-02T14:00:00" });
  ok("stop after more than 240 minutes records but warns 'quên dừng?'", !r.isError && textOf(r).includes("phiên dài bất thường, quên dừng?") && textOf(r).includes("480 phút"), textOf(r));
  r = await call("sirius_start", { subject: "GCI", estimate_minutes: 30, now: "2026-11-03T06:00:00" });
  r = await call("sirius_stop", { outcome: "partial", minutes: 35, now: "2026-11-03T14:00:00" });
  ok("the minutes override silences the warning", !r.isError && !textOf(r).includes("quên dừng") && textOf(r).includes("35 phút"));

  /* ───────── 14. SmartDrive post-write hook (S3) ───────── */
  section("SmartDrive post-write hook");
  const FAKE_CMD = `"${process.execPath}" "${FAKE_SD}"`;
  rmSync(SD_MARKER, { force: true });
  const off = runCli(["week", "2026-10-12", "--write", "--now", NOW_WED], { SIRIUS_SMARTDRIVE_CMD: FAKE_CMD, FAKE_SD_MARKER: SD_MARKER, SIRIUS_SMARTDRIVE: "off" });
  await new Promise((res) => setTimeout(res, 800));
  ok("SIRIUS_SMARTDRIVE=off: no SmartDrive command runs, not even for search", off.code === 0 && !existsSync(SD_MARKER), off.err);
  const onRun = runCli(["week", "2026-10-12", "--write", "--now", NOW_WED], { SIRIUS_SMARTDRIVE_CMD: FAKE_CMD, FAKE_SD_MARKER: SD_MARKER }, ["SIRIUS_SMARTDRIVE"]);
  let calls = [];
  for (let i = 0; i < 40; i++) {
    if (existsSync(SD_MARKER)) {
      calls = readFileSync(SD_MARKER, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
      if (calls.some((c) => c[0] === "update")) break;
    }
    await new Promise((res) => setTimeout(res, 250));
  }
  const upd = calls.filter((c) => c[0] === "update");
  ok("search queries go through the SmartDrive command (lab and progress)", calls.some((c) => c[0] === "search" && c[1] === "lab") && calls.some((c) => c[0] === "search" && c[1] === "progress"), JSON.stringify(calls));
  ok("after week --write: smart-drive update <weekly_reviews folder> --quiet runs once", onRun.code === 0 && upd.length === 1 && fwdp(upd[0][1]).endsWith("/Roadmaps/weekly_reviews") && upd[0][2] === "--quiet", JSON.stringify(upd));
  ok("the hook says it notified SmartDrive", onRun.out.includes("đã báo SmartDrive cập nhật chỉ mục"));
  ok("never notifies for .sirius/ writes", calls.every((c) => !JSON.stringify(c).includes(".sirius")));
  rmSync(SD_MARKER, { force: true });
  const noWrite = runCli(["week", "2026-10-12", "--now", NOW_WED], { SIRIUS_SMARTDRIVE_CMD: FAKE_CMD, FAKE_SD_MARKER: SD_MARKER }, ["SIRIUS_SMARTDRIVE"]);
  await new Promise((res) => setTimeout(res, 800));
  const calls2 = existsSync(SD_MARKER) ? readFileSync(SD_MARKER, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  ok("week without --write never runs smart-drive update", noWrite.code === 0 && !calls2.some((c) => c[0] === "update"));

  /* ───────── 14b. Tooling repos from the manifest, missing board ───────── */
  section("tooling manifest and missing board");
  if (hasGit) {
    const TOOLING2 = join(TEST_DIR, "tooling_repo_two");
    mkdirSync(TOOLING2, { recursive: true });
    git(TOOLING2, ["init", "-q"]);
    for (const [i, d] of ["2026-10-13T09:00:00+07:00", "2026-10-16T09:00:00+07:00"].entries()) {
      put(join(TOOLING2, `g${i}.txt`), `${i}\n`);
      git(TOOLING2, ["add", "-A"]);
      git(TOOLING2, ["commit", "-q", "-m", `two ${i}`], d);
    }
    const CH2 = join(TEST_DIR, "constellation_with_manifest");
    put(
      join(CH2, "ecosystem.json"),
      JSON.stringify({
        version: "1",
        servers: [
          { name: "alpha", path: TOOLING2, command: "node", args: [] },
          { name: "beta", command: "node", args: [] },
          { name: "dup", path: TOOLING, command: "node", args: [] },
        ],
      }),
    );
    const wjm = JSON.parse(runCli(["week", "2026-10-12", "--json", "--now", NOW_WED], { CONSTELLATION_HOME: CH2 }).out);
    ok(
      "tooling repos = manifest paths plus SIRIUS_TOOLING_DIRS (deduped; servers without a path ignored)",
      wjm.infrastructure.toolingCommits === 5 && wjm.evidence.git.tooling.length === 2,
      JSON.stringify(wjm.evidence.git.tooling.map((t) => [t.name, t.commits.length])),
    );
  }
  const loose = join(TEST_DIR, "loose_out");
  put(join(loose, "progress.jsonl"), JSON.stringify({ v: 1, t: T(14, 15, 0), deck: "x", slide: 1, type: "quiz" }) + "\n");
  const lw = JSON.parse(runCli(["week", "2026-10-12", "--json", "--now", NOW_WED], { SIRIUS_EVIDENCE_DIRS: `${EVIDENCE_DIRS};${loose}` }).out);
  ok("evidence that matches no course is reported in the notes, not dropped", lw.notes.some((n) => n.includes("không gắn được với khóa nào") && n.includes("Aurora 1 sự kiện")), JSON.stringify(lw.notes));
  const hubMissing = join(TEST_DIR, "hub_missing_board");
  put(
    join(hubMissing, "ACTIVE_LEARNING.md"),
    ["## Active Projects", "", "### 1. Khóa Ma", `- Directory: [Khoa_Ma](${url(join(hubMissing, "Khoa_Ma"))})`, `- Tasks: [TASKS.md](${url(join(hubMissing, "Khoa_Ma"))}/TASKS.md)`, ""].join("\n"),
  );
  put(join(hubMissing, "TASKS.md"), "# t\n- [ ] [Deadline: 2026-10-20 10:00] [Priority: P1] Việc trung tâm.\n");
  const mb = runCli(["deadlines", "--json", "--hub", hubMissing]);
  let mbj;
  try {
    mbj = JSON.parse(mb.out);
  } catch {
    mbj = undefined;
  }
  ok(
    "a missing board file is a warning, not an error; other boards still work",
    mb.code === 0 && mbj?.warnings.some((x) => x.includes("Không tìm thấy bảng task") && x.includes("Khoa_Ma/TASKS.md")) && mbj.boards.some((b) => b.exists === false) && mbj.buckets.later.length === 1,
    mb.out.slice(0, 300) + mb.err,
  );
  ok("aliases ignore case and diacritics (name, folder, first word)", ["Khoa Ma", "khoa_ma", "KHÓA", "Khóa Ma"].every((s) => runCli(["deadlines", "--subject", s, "--hub", hubMissing]).code === 0));
  ok("an unknown alias is an error until .sirius/aliases.json defines it", runCli(["deadlines", "--subject", "ma quỷ", "--hub", hubMissing]).code === 1);
  put(join(hubMissing, ".sirius", "aliases.json"), JSON.stringify({ Khoa_Ma: ["ma quỷ"] }));
  ok("extra aliases from <hub>/.sirius/aliases.json", runCli(["deadlines", "--subject", "Ma Quỷ", "--hub", hubMissing]).code === 0);
  const nohub = runCli(["deadlines", "--hub", join(TEST_DIR, "does_not_exist")]);
  ok("a hub folder that does not exist is a clear error (exit 1)", nohub.code === 1 && nohub.err.includes("Không tìm thấy hub"));

  // A hub whose ACTIVE_LEARNING.md names folders and boards as plain relative paths (no file:/// links),
  // with a watchlist copy that carries the long project title as its prefix.
  const hubRel = join(TEST_DIR, "hub_relative");
  const ALPHA_NAME = "Alpha Course for Applied Statistics";
  const REL_V1 = "- [ ] [Deadline: 2026-09-26 23:59] [Priority: P1] Implement ridge regression from scratch";
  const REL_V2 = "- [ ] [Deadline: 2026-11-15 21:00] [Priority: P1] Implement ridge regression from scratch";
  const REL_URGENT = "- [ ] [Deadline: 2026-10-12 21:00] [Priority: P1] Submit the week 1 report";
  const REL_WATCH = `- [ ] [Deadline: 2026-09-26 23:59] [Priority: P1] ${ALPHA_NAME}: Implement ridge regression from scratch.`;
  put(
    join(hubRel, "ACTIVE_LEARNING.md"),
    [
      "# Active Learning Hub",
      "",
      "## Today's Dynamic Goal",
      "- Date: 2026-10-12",
      "- Subject: Alpha Course",
      "- Target: Re-plan the regression track",
      "- Status: In Progress",
      "- Deadline: 2026-10-17 23:59",
      "- Priority: P2",
      "",
      "## Active Priority Watchlist & Deadlines",
      REL_WATCH,
      "",
      "## Active Projects",
      "",
      `### 1. ${ALPHA_NAME}`,
      "- Directory: Alpha_Course",
      "- Tasks: Alpha_Course/TASKS.md",
      "- Next Action: Start week 1.",
      "- Deadline: 2026-10-30 21:00",
      "- Priority: P1",
      "",
      "### 2. Beta Lab",
      "- Directory: Beta_Lab",
      "- Tasks: Beta_Lab/TASKS.md",
      "- Next Action: Polish the draft.",
      "- Deadline: 2026-10-12 21:00",
      "- Priority: P1",
      "",
    ].join("\n"),
  );
  put(join(hubRel, "Alpha_Course", "TASKS.md"), ["# Alpha_Course tasks", "", REL_V1, REL_V2, ""].join("\n"));
  put(join(hubRel, "Beta_Lab", "TASKS.md"), ["# Beta_Lab tasks", "", REL_URGENT, ""].join("\n"));
  const rel = runCli(["deadlines", "--json", "--hub", hubRel, "--now", "2026-10-12T09:00:00"]);
  let relj;
  try {
    relj = JSON.parse(rel.out);
  } catch {
    relj = undefined;
  }
  ok(
    "relative Directory/Tasks values are understood (both boards found, no board warning)",
    rel.code === 0 && relj?.boards.some((b) => b.path === "Alpha_Course/TASKS.md" && b.exists) && relj.boards.some((b) => b.path === "Beta_Lab/TASKS.md" && b.exists) && !relj.warnings.some((x) => x.includes("Alpha_Course") || x.includes("Beta_Lab")),
    rel.out.slice(0, 300) + rel.err,
  );
  ok(
    "long-title prefix on the watchlist copy is stripped: one merged overdue item with alsoIn",
    relj?.buckets.overdue.length === 1 && relj.buckets.overdue[0].file === "Alpha_Course/TASKS.md" && relj.buckets.overdue[0].alsoIn?.[0]?.startsWith("ACTIVE_LEARNING.md:") && relj.merged === 1,
    JSON.stringify(relj?.buckets.overdue.map((i) => [i.file, i.alsoIn])),
  );
  ok(
    "same description with a different deadline is a different task; urgent item merged with its project block",
    relj?.buckets.later.some((i) => i.deadline === "2026-11-15 21:00" && i.kind === "task") && relj.buckets.urgent.length === 1 && relj.buckets.urgent[0].file === "Beta_Lab/TASKS.md" && relj.buckets.urgent[0].alsoIn?.length === 1,
  );
  ok("the goal subject 'Alpha Course' resolves through the first-word alias", relj?.buckets.later.some((i) => i.kind === "goal" && i.subject === "Alpha_Course"));
  const recRel = runCli(["triage", "record", JSON.stringify([{ id: relj.buckets.overdue[0].id, decision: "superseded" }]), "--hub", hubRel, "--now", "2026-10-12T09:00:00"]);
  const relj2 = JSON.parse(runCli(["deadlines", "--json", "--hub", hubRel, "--now", "2026-10-12T09:00:00"]).out);
  const relTj = JSON.parse(readFileSync(join(hubRel, ".sirius", "triage.json"), "utf8"));
  ok(
    "one decision on the kept id excludes the merged watchlist copy too (the contract pick_today.py relies on)",
    recRel.code === 0 && relj2.buckets.overdue.length === 0 && relj2.triaged === 1 && relTj.entries.length === 1 && relTj.entries[0].raw === REL_V1 && relTj.entries[0].copies?.[0]?.raw === REL_WATCH,
    recRel.err + JSON.stringify(relTj.entries[0]),
  );
  const relWeek = runCli(["week", "2026-10-12", "--json", "--hub", hubRel, "--now", "2026-10-14T21:00:00"]);
  let relWeekJ;
  try {
    relWeekJ = JSON.parse(relWeek.out);
  } catch {
    relWeekJ = undefined;
  }
  ok("a hub without any git repository and without a plan still produces a weekly review (notes, not errors)", relWeek.code === 0 && relWeekJ?.week?.label === "2026-W42" && relWeekJ.notes.some((n) => n.includes("MASTER_ROADMAP") || n.includes("Không tìm thấy Roadmaps")), relWeek.err + JSON.stringify(relWeekJ?.notes));

  /* ───────── 15. Invariants ───────── */
  section("invariants");
  const changed = [];
  for (const [rel, h] of mdHashes) {
    const p = join(HUB, rel);
    if (!existsSync(p) || sha(p) !== h) changed.push(rel);
  }
  ok("sha256 of every fixture markdown file is unchanged (Sirius never edits learner files)", changed.length === 0, changed.join(", "));
  const filesAfter = walk(HUB).map((f) => relative(HUB, f).replace(/\\/g, "/"));
  const beforeFwd = new Set([...filesBefore].map((f) => f.replace(/\\/g, "/")));
  const created = filesAfter.filter((f) => !beforeFwd.has(f));
  const outside = created.filter((f) => !f.startsWith(".sirius/") && f !== "Roadmaps/weekly_reviews/2026-W42.md");
  ok("the only file created outside .sirius/ is the weekly review", outside.length === 0 && created.includes("Roadmaps/weekly_reviews/2026-W42.md"), outside.join(", "));
  ok(".sirius holds exactly journal.jsonl, triage.json and .gitignore (no leftovers)", readdirSync(join(HUB, ".sirius")).sort().join(",") === ".gitignore,journal.jsonl,triage.json", readdirSync(join(HUB, ".sirius")).join(","));
  ok(".sirius/.gitignore was never overwritten", readFileSync(GI, "utf8").replace(/\r\n/g, "\n") === "# Created by Sirius: personal study data, never commit.\n*\n");
  if (hasGit) {
    const st2 = git(HUB, ["status", "--porcelain", "--ignored", ".sirius"]);
    ok("A4: .sirius is still ignored after all writes", /^!! \.sirius\/$/m.test(st2.stdout) && !/^\?\? /m.test(st2.stdout), st2.stdout.trim());
  }
  // Rigel is read, never written: its folders stay byte-identical and nothing is created next to them
  const studyAfter = STUDY_SNAP_DIRS.map(snapDir);
  ok(
    "Rigel folders are untouched: same entries, byte-identical activity.jsonl, nothing created beside them",
    studyAfter.join("\n") === studyBefore.join("\n") && readdirSync(STUDY_HOME).join() === "activity.jsonl",
    STUDY_SNAP_DIRS.map((d, i) => (studyAfter[i] === studyBefore[i] ? "" : `${d}: ${studyBefore[i]} -> ${studyAfter[i]}`)).filter(Boolean).join("; "),
  );
  ok(
    "the missing study folder was never created, and a home without .rigel stays empty",
    !existsSync(STUDY_MISSING) && !existsSync(join(EMPTY_HOME, ".rigel")) && readdirSync(EMPTY_HOME).length === 0 && readdirSync(STUDY_EMPTY).length === 0,
  );
  const leakedIn = walk(HUB).filter((f) => readFileSync(f, "utf8").includes(STUDY_MARK));
  ok(
    "query text found in the log never reaches a tool or CLI output, the journal, .sirius or any file of the hub",
    !ALL_OUT.some((s) => s.includes(STUDY_MARK)) && leakedIn.length === 0,
    leakedIn.map((f) => relative(HUB, f)).join(", "),
  );
  const docsOf = ["README.md", "README.vi.md", join("guide", "GUIDE.md"), "PLAN.md"].map((f) => readFileSync(join(ROOT, f), "utf8"));
  ok(
    "docs: README.md, README.vi.md, guide/GUIDE.md and PLAN.md name Rigel, activity.jsonl and both folder variables",
    docsOf.every((d) => ["Rigel", "activity.jsonl", "SIRIUS_RIGEL_HOME", "RIGEL_HOME"].every((s) => d.includes(s))),
  );
  ok(
    "docs: the read-only promise and the no-query-text promise are stated in English and Vietnamese",
    docsOf[0].includes("never logs query text") && docsOf[2].includes("never logs query text") && docsOf[1].includes("không bao giờ ghi lại nội dung câu hỏi") && /0\.1\.1/.test(docsOf[3]),
  );

  // a user-owned .sirius/.gitignore must be respected, never overwritten
  const alt = join(TEST_DIR, "hub_gitignore_probe");
  mkdirSync(join(alt, ".sirius"), { recursive: true });
  writeFileSync(join(alt, ".sirius", ".gitignore"), "custom\n", "utf8");
  writeFileSync(join(alt, "ACTIVE_LEARNING.md"), "## Active Projects\n", "utf8");
  writeFileSync(join(alt, "TASKS.md"), "# t\n", "utf8");
  const probe = runCli(["log", "hub", "20", "done", "--kind", "meta", "--hub", alt, "--now", "2026-10-12T10:00:00"]);
  ok("an existing .sirius/.gitignore is never overwritten", probe.code === 0 && readFileSync(join(alt, ".sirius", ".gitignore"), "utf8") === "custom\n", probe.out + probe.err);
  // journal robustness: a last line without newline never gets glued to the next record
  writeFileSync(join(alt, ".sirius", "journal.jsonl"), '{"broken":', "utf8");
  const probe2 = runCli(["log", "hub", "15", "done", "--kind", "meta", "--hub", alt, "--now", "2026-10-12T11:00:00"]);
  const pl = readFileSync(join(alt, ".sirius", "journal.jsonl"), "utf8").split("\n").filter(Boolean);
  ok("append after a journal line without newline starts a new line", probe2.code === 0 && pl.length === 2 && pl[0] === '{"broken":' && JSON.parse(pl[1]).type === "session", pl.join(" | "));
  // a corrupt active.json is reported, not ignored
  writeFileSync(join(alt, ".sirius", "active.json"), "{not json", "utf8");
  const probe3 = runCli(["stop", "done", "--hub", alt, "--now", "2026-10-12T12:00:00"]);
  ok("a corrupt active.json gives a clear error", probe3.code === 1 && probe3.err.includes("active.json bị hỏng"), probe3.err);
  rmSync(join(alt, ".sirius", "active.json"), { force: true });
  const badKind = runCli(["start", "PM", "30", "--kind", "bogus"]);
  ok("CLI start with an unknown kind is an error", badKind.code === 1 && badKind.err.includes("kind không hợp lệ"), badKind.err);
  ok("CLI accepts --flag=value", runCli(["deadlines", "--json", `--hub=${HUB}`, "--subject=ML"]).code === 0);

  /* ───────── 16. triage.json heals after manual edits ───────── */
  section("triage.json heals after manual edits");
  const tjBefore = JSON.parse(readFileSync(TJ, "utf8"));
  ok("triage.json holds 4 excluded entries (V1, central old, KNN, PM old)", tjBefore.entries.length === 4, tjBefore.entries.map((e) => e.decision).join(","));
  const mlPath = join(ML, "TASKS.md");
  const mlRaw = readFileSync(mlPath, "utf8");
  writeFileSync(mlPath, "\r\n" + mlRaw, "utf8"); // every ML line moves down by one
  let hr = runCli(["triage", "list"]);
  let tjAfter = JSON.parse(readFileSync(TJ, "utf8"));
  const eV1b = tjAfter.entries.find((e) => e.taskId === ID.mlV1);
  const eKnnb = tjAfter.entries.find((e) => e.taskId === ID.mlKnn);
  ok("heal: moved lines get the new line number and keep the same raw", hr.code === 0 && eV1b?.line === LN.mlV1 + 1 && eKnnb?.line === LN.mlKnn + 1 && eV1b.raw === ML_V1_LINE, JSON.stringify(eV1b));
  ok("heal: the merged watchlist copy is still attached", eV1b?.copies?.[0]?.line === LN.alWatchMl);
  writeFileSync(mlPath, mlRaw.replace("Co-efficient Shrinkage", "Co-efficient Shrinkage (đã sửa)"), "utf8");
  hr = runCli(["triage", "list"]);
  tjAfter = JSON.parse(readFileSync(TJ, "utf8"));
  ok("heal: editing the text orphans the decision and drops it from triage.json", hr.out.includes("Mồ côi: 2 mục") && tjAfter.entries.length === 3 && !tjAfter.entries.some((e) => e.taskId === ID.mlV1), hr.out.split("\n").filter((l) => l.includes("Mồ côi")).join("|"));
  const after = runCli(["deadlines", "--json"]);
  ok("the edited line is a new untriaged task and shows as overdue again", JSON.parse(after.out).buckets.overdue.some((i) => i.text.includes("(đã sửa)")));

  /* ───────── 17. No emoji anywhere ───────── */
  section("no emoji");
  const emoji = /\p{Extended_Pictographic}/u;
  ok("no emoji in any tool or CLI output", !ALL_OUT.some((s) => emoji.test(s)), ALL_OUT.find((s) => emoji.test(s))?.slice(0, 80));
} catch (e) {
  failed++;
  console.log(`FAIL test run crashed: ${e instanceof Error ? e.stack : String(e)}`);
} finally {
  try {
    await client.close();
  } catch {
    // ignore
  }
  if (process.env.SIRIUS_E2E_KEEP) {
    console.log(`\nfixture kept at ${TEST_DIR}`);
  } else {
    try {
      rmSync(TEST_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // ignore (git pack files can be read-only on Windows)
    }
  }
}

console.log("\n-------------------------------------------");
console.log(`E2E SUMMARY: ${passed} ok, ${failed} FAIL`);
if (failed > 0) {
  console.error(`FAILED: ${failed} check(s) failed.`);
  process.exit(1);
} else {
  console.log("ALL E2E CHECKS PASSED!");
  process.exit(0);
}
