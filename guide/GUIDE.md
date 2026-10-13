# Sirius MCP Guide

Sirius is the execution loop of the learner's MCP ecosystem: a deterministic deadline sentinel, task triage, today router, if-then commitments, a session timer, and a weekly plan-vs-actual review. Named after the star whose rising set the ancient Egyptian calendar: Sirius keeps time and watches deadlines.

## Ecosystem Table

| Project | Author | Role in Learning Hub |
|---|---|---|
| **Polaris** | DuongNAD | Course architect, roadmaps, facts, and spaced-review error log |
| **Aurora Slides** | DuongNAD | Keynote-grade lessons, notebook pages, memory palaces, quizzes, progress events |
| **Mira** | DuongNAD | Code-tracing lab; its players emit predict events into Aurora progress files |
| **SmartDrive-OS** | DuongNAD | SSD storage governance, indexing, and fast learning search |
| **Constellation** | DuongNAD | MCP ecosystem registration, health checks, and contracts |
| **Vega** | DuongNAD | Adaptive spaced repetition memory engine (FSRS) |
| **Orion** | DuongNAD | Practice labs, real test runners, tutoring ladder, and attempt history |
| **Sirius** | DuongNAD | Deadlines, triage, today router, commitments, timer, weekly review |

---

## 1. Principles

1. **Read-only on learner files.** Never edit `TASKS.md`, `ACTIVE_LEARNING.md`, `INDEX.md`, roadmaps. State lives in `<hub>/.sirius/`; the only other write is `Roadmaps/weekly_reviews/<YYYY>-W<ww>.md` with `sirius_week { write: true }`.
2. **Record only explicit inputs.** The learner's words and decisions; no inference. Triage suggestions are recorded only after the learner confirmed them in chat.
3. **Evidence is read-only.** Vega, Orion, Aurora, Mira, Polaris, Rigel and git are read; Sirius never writes into them. For Rigel it only counts what the log holds and never logs query text.
4. **No recursive scans of D:** (exFAT). Open known files by exact path. Orion labs and Aurora/Mira progress files come from the SmartDrive index (`smart-drive search ... --json`) or `SIRIUS_EVIDENCE_DIRS` (each folder listed one level).
5. **Learner text in Vietnamese with correct diacritics, no emoji.** Code, JSON keys and tool names in English.
6. **Privacy.** Before every write into `<hub>/.sirius/`, `<hub>/.sirius/.gitignore` is created if missing (never overwritten) with exactly:
   ```
   # Created by Sirius: personal study data, never commit.
   *
   ```
   so the journal stays out of git even when the hub's root `.gitignore` lacks `.sirius/`.
7. **Toolchain discipline.** TypeScript, one bundle `dist/sirius.mjs`, toolchain outside the project; never `npm install` in the project folder.

---

## 2. Session loop for agents

1. `sirius_deadlines`. Overdue items first; for items under 24 hours say the exact countdown and give a focus plan; under 48 hours steer the session; under 72 hours suggest blocking time.
2. `sirius_today` to route the day (deadline priorities, weekly template, due reviews, commitments, "Bước tiếp theo" per subject).
3. `sirius_commit { subject, time, action, minutes, where? }`: a first concrete action the learner can start immediately.
4. `sirius_start { subject, estimate_minutes, ... }` before studying and `sirius_stop { outcome }` after. For sessions that were not timed use `sirius_log`.
5. `sirius_triage { action: "suggest" }`, show the result to the learner, and `record` only the decisions they confirm.
6. Sunday: `sirius_week { write: true }`; `sirius_stats` for trends.

---

## 3. Deadline engine

Items: (1) unchecked task lines with a `[Deadline: YYYY-MM-DD HH:mm]` from every board (central `TASKS.md`, each project board linked by `- Tasks:` in `ACTIVE_LEARNING.md` or by the router table in `TASKS.md`, and the `ACTIVE_LEARNING.md` watchlist), (2) each Active Project `- Deadline:`, (3) Today's Dynamic Goal when Status is not `Completed`. Checked lines and lines inside fenced code blocks are ignored; a missing time means 23:59.

Buckets by remaining time: `overdue` (< 0), `urgent` (<= 24 h), `h48`, `h72`, `later`. Sorted by deadline, then P0 < P1 < P2.

- Project and goal items are dropped when a task has the same subject and the same deadline minute; the task keeps an `alsoIn` reference (`ACTIVE_LEARNING.md:55`).
- Cross-board duplicates (usually a watchlist line copied from a project board) are merged when the normalised text (lowercase, no diacritics, leading `<Subject>:` prefix and backticks removed) and the raw deadline string are equal. The project-board copy is kept (then central, then watchlist) and rows show `(cũng có ở ACTIVE_LEARNING.md:39)`. A triage decision on the kept id covers the merged item.
- `Hạn không thống nhất`: two lines of one subject (checked or not) whose content tokens have Jaccard >= 0.6 but whose deadlines differ; standalone numbers must agree, so "Buổi 1" and "Buổi 2" are not a conflict.
- `Lệch định dạng`: unchecked lines missing `Deadline` or `Priority`.
- Countdown text: `còn 23 giờ 12 phút`, `còn 2 ngày 5 giờ`, `quá hạn 16 ngày 1 giờ`, `quá hạn 40 phút`.
- Default report shows the overdue count per board plus the 10 most recently due rows; `detail: true` lists all.

`--json` (CLI) returns `{now, nowText, today, weekday, buckets: {overdue, urgent, h48, h72, later}, triaged, triagedItems, deviations, conflicts, boards, warnings, invalidJournalLines, merged}`. Each item: `kind` (task, project, goal), `id`, `subject`, `priority`, `deadline`, `remainingMs`, `countdown`, `text`, `file`, `line`, `section`, `alsoIn?`.

Task ids: first 10 hex characters of sha1(`<path relative to the hub, forward slashes, lowercase>|<deadline "YYYY-MM-DD HH:mm" or empty>|<text>`), where `text` is the line without the Deadline and Priority tags, whitespace collapsed.

---

## 4. Triage

`suggest` (read-only) looks at each overdue untriaged task T and the unchecked later-deadline tasks R on the same board (for a watchlist line also the subject's project board):

- Tokens: lowercase, no diacritics, link targets removed, stopwords and years dropped, tokens of at least 3 characters or codes like `m3.2`, `hw4`, `4.01`.
- Superseded when R says `thay` and one of the next 6 tokens belongs to T, or when Jaccard(T, R) >= 0.2 and (numbers in both agree) and (at least one shared token appears in at most 3 task lines of the subject). The two guards stop sibling tasks of one sequence from being proposed as replacements.
- With `before: YYYY-MM-DD`, tasks due earlier than that date become superseded ("thuộc kế hoạch trước ...").
- Overdue more than 14 days with no replacement: `parked`. Otherwise `active`.

The output ends with a JSON array for `record`. `record` validates every id (unknown ids are reported with the closest ids), requires `until >= today` for `snoozed`, and writes all or nothing. `list` shows the latest decision per id and orphaned decisions (ids that no longer match a line because the learner edited it).

Effect on alerts: `superseded` and `parked` exclude the task; `snoozed` excludes it while `until >= today`; `active` changes nothing.

### Interop: `<hub>/.sirius/triage.json`

`pick_today.py` cannot read the journal, so every `triage record` (and every `triage list`) rewrites this derived file atomically from the latest decisions and the CURRENT task lines:

```json
{
  "v": 1,
  "updated": "2026-10-12T00:47:00+07:00",
  "entries": [
    {
      "taskId": "7c98927089",
      "file": "Machine_Learning/TASKS.md",
      "line": 31,
      "raw": "- [ ] [Deadline: 2026-09-26 23:59] [Priority: P1] Cài đặt thuật toán Ridge ...",
      "deadlineRaw": "2026-09-26 23:59",
      "text": "Cài đặt thuật toán Ridge ...",
      "decision": "superseded",
      "until": "only for snoozed, YYYY-MM-DD",
      "replacedBy": "task id",
      "note": "free text",
      "at": "2026-10-12T00:47:00+07:00",
      "copies": [{ "file": "ACTIVE_LEARNING.md", "line": 39, "raw": "- [ ] ... Machine Learning: Cài đặt ..." }]
    }
  ]
}
```

Only decisions that currently exclude an unchecked task are listed. The file is pure ASCII (non-ASCII characters are `\uXXXX` escapes), so `json.load` yields the exact `raw` line even if the reader opens it with the wrong default encoding. To skip excluded tasks, compare each parsed task line with `entry["raw"]` (and each `copies[].raw`) and ignore `snoozed` entries whose `until` is before today.

---

## 5. Plan parser (`Roadmaps/MASTER_ROADMAP.md`)

Tolerant: format drift becomes `warnings` with line numbers, never an exception.

- Base year: the first `YYYY-MM-DD` of the first heading. Dates `12/10` are day/month; a range whose end month is smaller than the start month, or a date earlier than the previous one, moves into the next year.
- `## 3.` budget table: rows `I. 12/10-25/10 (...)`, `III. Từ 21/12 (...)`; cells `5-6,5 giờ`, `3 giờ`, `0`, `khoảng 14-16 giờ`; columns after `Giai đoạn` until `Tổng` are mapped to subjects (unknown labels warn and are dropped).
- `## 4.` weekly template: a bold `**Giai đoạn I (đến 25/10)**` then `| Ngày | Buổi chính | Buổi phụ |`. Cell syntax: segments split on " và " (fragments that are not sessions are glued back), subject = text before the first `,` `:` or `(`, minutes `(60 phút)` / `(30-60 phút)` / clock range `18:00-19:30`, ` hoặc ` gives alternatives, `ôn xuyên khóa` is a cross-course review, `Không` no session, `Nghỉ` rest, `Dự phòng` buffer. Unknown subjects keep their label with `subject: null` and a warning.
- `## 5.` milestones: `| Tuần | GCI (P0) | Machine Learning | ... |`, weeks `12-18/10` or `26/10-01/11`.
- API: `getPhaseFor(date)`, `getDayPlan(date)`, `getWeekBudget(weekStart)` (phase containing Monday), `getMilestones(date)`.

Subject aliases (case and diacritics ignored): full name, folder name with `_` as spaces, first word (3+ letters), initials (`ML`, `QC`, `PM`), plus `<hub>/.sirius/aliases.json` (`{"Machine_Learning": ["học máy"]}`).

---

## 6. Journal (`<hub>/.sirius/journal.jsonl`)

One JSON object per line, validated on write and on read (invalid lines are skipped and counted). All have `v: 1`, `type`, `at`.

| type | fields |
|---|---|
| `session` | `id` (`s_` + 8 hex), `subject` (key), `kind` (learn, practice, review, homework, project, meta), `task?`, `start`, `end`, `minutes`, `estimate?`, `outcome` (done, partial, blocked, abandoned), `note?`, `commitId?`, `source` (timer, log) |
| `commit` | `id` (`c_` + 8 hex), `date`, `time`, `subject`, `action`, `where?`, `minutes` (>= 5) |
| `triage` | `taskId`, `decision`, `until?`, `replacedBy?`, `note?`, `file`, `line`, `text`, `raw?`, `deadlineRaw?` |

`kind: meta` is planning, organising, building tools, editing roadmaps: real work, shown separately from study.

Commitment status: kept (session of the same subject starts within 30 minutes before to 90 minutes after the time), late (linked session outside the window, or a later session that day), missed (day over, nothing started), pending otherwise. A running timer counts as started.

---

## 7. Weekly review and stats

`sirius_week` sections: summary, per-subject table (`Kế hoạch (giờ)`, `Thực tế (giờ)`, `Phiên`, `Bằng chứng`, `Hạn trong tuần`, `Trạng thái`: Đúng nhịp, Hụt nhịp, Chưa học, Ngoài kế hoạch), plan per day versus actual, estimate accuracy (median actual / estimate, at least 3 samples), deadlines and principle 7, study versus infrastructure, Sunday ritual, source notes, shareable summary (at most 5 lines, no paths).

- **Capacity (`Năng lực thực tế`)**: median weekly study hours of the last 3 completed ISO weeks that have logged study sessions (needs 2). When the budget minimum exceeds 1.5 times that median the review says by how much and points to principle 7.
- **Streak** (`sirius_stats`): qualifying day = non-meta session of at least 10 minutes. Walking back from today (today counts only once it qualifies), one empty day is tolerated and two consecutive empty days end the chain. Reported as `N ngày học trong M ngày liên tục`, plus `Số ngày học trong 14 ngày qua: n/14`.
- **Daily minimum** (`sirius_today`): `Mức tối thiểu hằng ngày: 25 phút (đã đạt)` or `(còn N phút)`; change with `SIRIUS_DAILY_MIN`.
- **Rigel activity** (`sirius_week`): the `Bằng chứng` column gets `Hỏi đáp có nguồn N (mạnh a, yếu b, không c)` and `Thẻ từ tài liệu M` (zeros dropped); `Học và hạ tầng` adds one line with the totals (questions, cards, saved notes) and counts them as study evidence. `sirius_stats` adds a table `Hỏi đáp có nguồn theo tuần (Rigel)` only when the weeks shown contain activity; every `--json` week row carries a `study` object. See section 8.

`write: true` saves `Roadmaps/weekly_reviews/<YYYY>-W<ww>.md` (overwrites that week) and then runs `smart-drive update <folder> --quiet` detached and ignoring failures (disabled by `SIRIUS_SMARTDRIVE=off|false|0|no`, command override `SIRIUS_SMARTDRIVE_CMD`). `.sirius/` writes never trigger it.

---

## 8. Evidence sources

| Source | Read | Notes |
|---|---|---|
| Vega | `.vega/cards.json` (due by end of day, not suspended), `.vega/reviews.jsonl` (`t`, `at`, `timestamp`, `review`, `reviewed_at`) | Card subject mapped through the card's `subject` |
| Orion | `lab.json`, `orion-attempts.jsonl` | Labs from `smart-drive search lab --ext json --dir <hub folder> --json --limit 200` (only `lab.json` entries) plus `SIRIUS_EVIDENCE_DIRS`; subject by folder prefix, else `lab.json` `subject` |
| Aurora | `progress.jsonl`, `aurora-progress-*.jsonl` | Counted by `type`; subject by folder prefix, else `course` |
| Mira | same files | Events with `slideId` starting `mira-stop-`: `Mira dò code a/b đúng` (predict events, rating right), excluded from the Aurora count |
| Polaris | `<subject dir>/polaris/errorlog.md` (`### [YYYY-MM-DD]` headings), `reviews.json` (steps), `schedule.json` | Review steps due: `done` false and `dueDate <= date` |
| Rigel | `activity.jsonl` in the Rigel folder: `SIRIUS_RIGEL_HOME`, else `RIGEL_HOME`, else `%USERPROFILE%/.rigel` | One JSON line per Rigel tool call: `{"v":1,"t","tool","course","lesson","subject","coverage"?,"hits","cards"?}`. Counted per subject over the week: `search_material` calls (questions) split by `coverage` strong / weak / none, the sum of `cards` of `export_flashcards`, `save_note` calls. Other tools are ignored |
| git | `git log` per subject folder (own `.git`, else the hub repo limited to the folder) and tooling repos | Tooling repos: `path` of the servers in `%USERPROFILE%/.constellation/ecosystem.json` (or `CONSTELLATION_HOME`) plus `SIRIUS_TOOLING_DIRS`; 15 s timeout per call |

Each reader is bounded and read-only; failures become notes under "Ghi chú nguồn dữ liệu".

### Rigel specifics

- Read-only and count-only: Sirius never writes into the Rigel folder (it creates nothing there) and never logs query text. It copies no text out of the log into the journal, the weekly review or any tool result; a `query` field, should a later Rigel version add one, is ignored.
- Subject of a line: its `subject` when it resolves to a hub subject, else its `course` through the subject aliases (GCI, ML, PM, QC, AMD, plus `<hub>/.sirius/aliases.json`). A line that resolves to neither goes to the bucket `khác` (JSON key `khác` under `evidence.study.bySubject`) and adds one note naming up to three labels. `khác` has no row in the table but is part of the totals.
- Missing `activity.jsonl`: skipped silently. A note appears only when `SIRIUS_RIGEL_HOME` or `RIGEL_HOME` points to a folder that does not exist, or when the log exists but cannot be read.
- Bounded: at most the last 4 MB of the log is read (`Rigel: activity.jsonl lớn, chỉ đọc phần cuối.`). Lines that are not JSON, have no valid `t`, name another tool, or carry `v` other than 1 are skipped.
- JSON: `evidence.study.bySubject.<key> = {questions, strong, weak, none, cards, notes}` and `infrastructure.studyEvidence` (totals) in `sirius_week --json`; `weeks[].study` and `notes` in `sirius_stats --json`.

---

## 9. Environment variables

`SIRIUS_HUB`, `POLARIS_HUB`, `SIRIUS_NOW`, `SIRIUS_SMARTDRIVE`, `SIRIUS_SMARTDRIVE_CMD`, `SIRIUS_EVIDENCE_DIRS`, `SIRIUS_TOOLING_DIRS`, `SIRIUS_RIGEL_HOME`, `RIGEL_HOME`, `SIRIUS_DAILY_MIN`, `SIRIUS_TOOLCHAIN` (build only). Hub: `hub` param, then `SIRIUS_HUB`, `POLARIS_HUB`, `D:/02_Learning_Knowledge`. Clock: `now` param, `SIRIUS_NOW`, system time (machine local time zone).

---

## 10. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `Không nhận ra khóa "X"` | The error lists the closest names; add an alias in `<hub>/.sirius/aliases.json` |
| Plan warnings in "Ghi chú" | A label in MASTER_ROADMAP matches no Active Project; fix the label or add an alias |
| Overdue count seems too high | Run `sirius_triage { action: "suggest" }`; many tasks belong to a replaced plan |
| `Đang có phiên chạy` on start | A timer is running; `sirius_stop` it (or delete `.sirius/active.json` if it is stale) |
| `N dòng journal không hợp lệ` | Some journal lines are not valid records; they are skipped and never rewritten |
| No Orion/Aurora evidence | SmartDrive off or missing: set `SIRIUS_EVIDENCE_DIRS` to the lab and progress folders |
| `git log lỗi` note | git missing or the repo is not accessible; the other evidence still works |
| No Rigel evidence | Nothing to do if Rigel was not used. Otherwise check that `<Rigel home>/activity.jsonl` exists (`SIRIUS_RIGEL_HOME`, `RIGEL_HOME`, `%USERPROFILE%/.rigel`) and that its lines are dated inside the week |
| `Rigel: N lần gọi không gắn được với khóa nào` | The `subject` and `course` of those lines match no hub subject; add an alias in `<hub>/.sirius/aliases.json`. They stay counted under `khác` |
