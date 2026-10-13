[Tiếng Việt](README.vi.md) | English

<p align="center"><img src="docs/banner.jpg" alt="Sirius MCP — Sirius rising before dawn over a dark horizon" width="100%"></p>

# Sirius MCP

*Named after the star whose rising set the ancient Egyptian calendar: Sirius keeps time and watches deadlines.*

Sirius is the execution loop of the learner's MCP ecosystem: a deterministic deadline sentinel, task triage for overdue work, a today router, if-then commitments (implementation intentions), a session timer, and a weekly plan-vs-actual review that sets real hours next to the plan, the weekly budget, and what Vega, Orion, Aurora, Mira, Polaris, Rigel and git recorded.

---

## Ecosystem

All projects by DuongNAD:

| Project | Role | Repository |
| :--- | :--- | :--- |
| **Polaris** | Course architect: sources, facts with locators, roadmap, schedule, error log | [polaris-mcp](https://github.com/DuongNAD/polaris-mcp) |
| **Aurora Slides** | Keynote-style lessons: quizzes, predict and trace slides, progress events | [aurora-slides-mcp](https://github.com/DuongNAD/aurora-slides-mcp) |
| **Vega** | FSRS memory engine and the single review queue (card inbox) | [vega-mcp](https://github.com/DuongNAD/vega-mcp) |
| **Orion** | Practice labs with real tests, tutoring ladder and PRIMM warm-up | [orion-mcp](https://github.com/DuongNAD/orion-mcp) |
| **Mira** | Code-tracing lab: real Python traces, line-by-line players with prediction gates | [mira-mcp](https://github.com/DuongNAD/mira-mcp) |
| **Rigel** | Grounded tutor: answers from the learner's lesson materials with [ref] citations | [rigel-mcp](https://github.com/DuongNAD/rigel-mcp) |
| **Sirius** | Execution loop: deadlines, triage, today router, session timer, weekly review | [sirius-mcp](https://github.com/DuongNAD/sirius-mcp) |
| **Constellation** | MCP registration, health checks and shared contracts | [constellation-mcp](https://github.com/DuongNAD/constellation-mcp) |
| **SmartDrive-OS** | SSD governance, index and learning search | [smart-drive-os](https://github.com/DuongNAD/smart-drive-os) |

### Connections

- Reads evidence from Vega, Orion, Aurora and Mira, Polaris, Rigel and git (read-only); finds files through the SmartDrive-OS index.
- The today router suggests `polaris_today`, `vega_session` and `orion_run`; `pick_today.py` honours Sirius' `triage.json`.

---

## Why Sirius?

The hub had many plans and few executed sessions. On 2026-10-12 about 60 unchecked tasks were overdue (most from a v1 plan replaced by the v2 roadmaps and never closed), the Vega collection had 4 cards and 0 reviews, the first Orion lab had 0 attempts, and the scheduler profile said 1.5 h/week while the master roadmap budgets 14-16 h/week. Nothing measured what was actually done, so plans could not learn from reality, and every agent session re-implemented the `AGENTS.md` deadline rule by hand.

Sirius makes that rule a tool, turns plans into if-then commitments, measures actual time against estimates and the weekly budget, and shows learning time versus meta-work (planning, tooling).

---

## Principles

1. **Read-only on learner files**: Sirius never edits, ticks or deletes anything in `TASKS.md`, `ACTIVE_LEARNING.md`, `INDEX.md` or the roadmaps. Its state lives in `<hub>/.sirius/`. The only other write is the optional weekly review file `Roadmaps/weekly_reviews/<YYYY>-W<ww>.md`.
2. **Record only what the learner did or decided**: `commit`, `start`, `stop`, `log` and `triage record` take explicit inputs. Triage suggestions are recorded only after the learner confirms them in chat.
3. **Evidence is read, never written**: Sirius reads Vega, Orion, Aurora, Mira, Polaris, Rigel and git; it never writes into them. It only counts what Rigel logged and never logs query text.
4. **No recursive scans of D:** (exFAT external SSD): files are opened by exact path; Orion labs and Aurora/Mira progress files are located through the SmartDrive index or `SIRIUS_EVIDENCE_DIRS`.
5. **Vietnamese for the learner, English for code**: tool results and the guide are Vietnamese with correct diacritics; no emoji.
6. **Toolchain discipline**: TypeScript, one esbuild bundle `dist/sirius.mjs`, zero runtime dependencies, toolchain outside the project (`SIRIUS_TOOLCHAIN`).
7. **Personal data stays local**: before every write into `<hub>/.sirius/`, Sirius makes sure `<hub>/.sirius/.gitignore` exists with exactly `# Created by Sirius: personal study data, never commit.` and `*` (created when missing, never overwritten). The journal stays out of git even when the hub's root `.gitignore` does not list `.sirius/`.

---

## MCP Tools & CLI Commands

| MCP Tool | CLI Command | Purpose |
|---|---|---|
| `sirius_guide {topic?}` | `sirius guide [topic]` | Read the guide: overview, deadlines, triage, plan, sessions, week, evidence, rules |
| `sirius_deadlines {hub?, now?, detail?, subject?}` | `sirius deadlines [--detail] [--subject <s>]` | Deadline sentinel: overdue (warn first), under 24 h with exact countdown, 48 h, 72 h, later; merged duplicates, format deviations, conflicting deadlines |
| `sirius_triage {action, before?, decisions?}` | `sirius triage suggest\|list\|record` | Suggest superseded / parked / active for overdue tasks, record the decisions the learner confirmed, list them |
| `sirius_today {date?}` | `sirius today [YYYY-MM-DD]` | Deadline priorities, weekly template, one next step per subject, due Vega/Polaris reviews, commitments, timer, daily minimum |
| `sirius_commit {subject, time, action, minutes, where?, date?}` | `sirius commit <subject> <HH:mm> <minutes> <action...>` | Record an if-then commitment |
| `sirius_start {subject, estimate_minutes, task?, kind?, commit_id?}` | `sirius start <subject> <estimate_minutes> [task...]` | Start the session timer |
| `sirius_stop {outcome, note?, minutes?}` | `sirius stop <outcome> [note...] [--minutes n]` | Stop the timer; actual / estimate ratio and today's total |
| `sirius_log {subject, minutes, outcome, kind?, task?, estimate_minutes?, date?, start_time?, note?, commit_id?}` | `sirius log <subject> <minutes> <outcome> [task...]` | Log a session that was not timed |
| `sirius_week {week?, write?}` | `sirius week [YYYY-MM-DD] [--write]` | Weekly review: hours vs budget, evidence, capacity, estimates, deadlines, shareable summary |
| `sirius_stats {weeks?}` | `sirius stats [--weeks n]` | Weekly trends (plus the weekly count of grounded questions when Rigel left activity), streak tolerant to one miss, capacity, estimate ratio, keep rate |

Global CLI options: `--hub <path>` (default `SIRIUS_HUB`, `POLARIS_HUB`, then `D:/02_Learning_Knowledge`), `--now <iso>`, `--json`. Exit code 0 on success, 1 on usage errors or errors.

Typical day: `sirius_deadlines` at session start, `sirius_today`, `sirius_commit`, `sirius_start` / `sirius_stop`, `sirius_triage { action: "suggest" }` (show, then record only what the learner confirms), and `sirius_week { write: true }` on Sunday.

---

## What Sirius reads (and never writes)

| Source | Files | Used for |
|---|---|---|
| Learning hub | `ACTIVE_LEARNING.md`, `TASKS.md`, each project's `TASKS.md`, `Roadmaps/MASTER_ROADMAP.md` | Deadlines, subjects, weekly template, budget, milestones |
| Vega | `.vega/cards.json`, `.vega/reviews.jsonl` | Cards due today, reviews per subject |
| Orion | `lab.json`, `orion-attempts.jsonl` | Attempts, time, latest result (next step `orion_run`) |
| Aurora | `progress.jsonl`, `aurora-progress-*.jsonl` | Events by type |
| Mira | the same progress files; events whose `slideId` starts with `mira-stop-` | `Mira dò code a/b đúng` (rating right / predict events), kept out of the Aurora count |
| Polaris | `<subject>/polaris/errorlog.md`, `reviews.json`, `schedule.json` | New error-log entries, review steps due and done, `polaris_today` hint |
| Rigel | `activity.jsonl` in the Rigel folder (`SIRIUS_RIGEL_HOME`, else `RIGEL_HOME`, else `%USERPROFILE%/.rigel`) | Per subject: grounded questions (`search_material`) with coverage strong / weak / none, flashcards exported (`export_flashcards`), notes saved (`save_note`) |
| git | `git log` of each subject folder and of the tooling repos | Commits in the week |

Rigel (the grounded Q&A server over the lesson materials) appends one JSON line per tool call to `activity.jsonl`. Sirius only reads that file and only counts: it never logs query text, never writes into the Rigel folder and creates nothing there. A missing file is skipped silently; a note appears only when `SIRIUS_RIGEL_HOME` or `RIGEL_HOME` points to a missing folder. A line belongs to its `subject` when that matches a hub subject, otherwise to its `course` through the subject aliases (GCI, ML, PM, QC, AMD, ...); what matches nothing is counted under `khác` with a note. The weekly review adds `Hỏi đáp có nguồn N (mạnh a, yếu b, không c)` and `Thẻ từ tài liệu M` to the evidence column (zeros dropped) and counts them as study evidence in "Học và hạ tầng"; `sirius_stats` adds a weekly count of grounded questions.

Written by Sirius: `<hub>/.sirius/` (`journal.jsonl`, `active.json`, `triage.json`, `.gitignore`) and, only with `write: true`, `Roadmaps/weekly_reviews/<YYYY>-W<ww>.md` (followed by a best-effort `smart-drive update <folder> --quiet`).

---

## Environment

| Variable | Meaning |
|---|---|
| `SIRIUS_HUB`, `POLARIS_HUB` | Hub folder (default `D:/02_Learning_Knowledge`) |
| `SIRIUS_NOW` | ISO 8601 clock override (tests) |
| `SIRIUS_SMARTDRIVE` | `off`, `false`, `0` or `no` disables every SmartDrive call; `SIRIUS_SMARTDRIVE_CMD` overrides the command |
| `SIRIUS_EVIDENCE_DIRS` | Extra folders (`;`-separated) holding Orion labs and Aurora/Mira progress files |
| `SIRIUS_TOOLING_DIRS` | Extra tooling repos (`;`-separated) for the commit comparison |
| `SIRIUS_RIGEL_HOME`, `RIGEL_HOME` | Rigel folder holding `activity.jsonl` (tried in this order, then `%USERPROFILE%/.rigel`); read-only |
| `SIRIUS_DAILY_MIN` | Daily minimum of study minutes (default 25) |
| `SIRIUS_TOOLCHAIN` | Build toolchain (then `ORION_TOOLCHAIN`, `VEGA_TOOLCHAIN`, `POLARIS_TOOLCHAIN`) |

---

## Development

```powershell
$env:SIRIUS_TOOLCHAIN = "C:\Users\Admin\AppData\Local\aurora-slides\toolchain"   # optional
node scripts/build.mjs --check
node scripts/e2e.mjs
node dist/sirius.mjs deadlines --hub D:/02_Learning_Knowledge
```

---

## License

MIT License (c) 2026 DuongNAD
