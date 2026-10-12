# Sirius MCP - plan and design

Sirius is the execution loop of the learner's MCP ecosystem: a deadline sentinel, task triage, today router,
implementation intentions (if-then commitments), a session timer, and a weekly plan-vs-actual review. Named after the
star whose heliacal rising set the ancient Egyptian calendar: Sirius keeps time and watches deadlines.

Ecosystem (all by DuongNAD): Polaris (course architect), Aurora Slides (lessons and progress events), Mira (code-tracing
lab that emits Aurora predict events), SmartDrive-OS (SSD governance and learning search), Constellation (registration,
health, contracts), Vega (FSRS memory), Orion (practice labs), Sirius (this).

## Why
Measured on 2026-10-12 the hub had many plans and few executed sessions: about 60 unchecked tasks overdue (most from a
v1 plan replaced by the v2 roadmaps on 2026-10-10 and never closed), a Vega collection with 4 cards and 0 reviews, a
first Orion lab with 0 attempts, and a scheduler profile of 1.5 h/week while the master roadmap budgets 14-16 h/week.
Nothing measured what was actually done, so plans could not learn from reality, and every agent session re-implemented
the AGENTS.md deadline rule by hand (grep plus mental arithmetic). Sirius makes that rule a deterministic tool, turns
plans into if-then commitments, measures actual time against estimates and the weekly budget, and separates study time
from meta-work (planning, tooling).

## Principles
1. Read-only on learner files: Sirius never edits, ticks or deletes anything in `TASKS.md`, `ACTIVE_LEARNING.md`,
   `INDEX.md`, roadmaps or any other learner file. All its state lives in `<hub>/.sirius/`. The only other write is the
   optional weekly review `Roadmaps/weekly_reviews/<YYYY>-W<ww>.md` (`sirius_week { write: true }`).
2. Record only explicit inputs: `commit`, `start`, `stop`, `log` and `triage record` store what the learner did or
   decided; nothing is inferred and written. Triage suggestions are shown to the learner and recorded only after the
   learner confirms them in chat.
3. Evidence is read-only: Vega, Orion, Aurora, Mira, Polaris and git are read, never written.
4. No recursive scans of D: (exFAT, 512 KB clusters). Files are opened by exact path; Orion labs and Aurora/Mira progress
   files are found through the SmartDrive index (`smart-drive search ... --json`) or `SIRIUS_EVIDENCE_DIRS` (each folder
   listed non-recursively).
5. Learner-facing text (tool results, guide, `README.vi.md`) is Vietnamese with correct diacritics; code, JSON keys and
   tool names are English. No emoji.
6. Same toolchain discipline as the sister projects: TypeScript, one esbuild bundle `dist/sirius.mjs`, zero runtime
   dependencies, toolchain outside the project (`SIRIUS_TOOLCHAIN`, then `ORION_TOOLCHAIN`, `VEGA_TOOLCHAIN`,
   `POLARIS_TOOLCHAIN`, then `%LOCALAPPDATA%/aurora-slides/toolchain`). No `npm install`, no `node_modules` on D:.
7. Personal data stays local: before every write into `<hub>/.sirius/` Sirius makes sure `<hub>/.sirius/.gitignore`
   exists with the two lines `# Created by Sirius: personal study data, never commit.` and `*` (created when missing,
   never overwritten), so the journal stays out of git even when the hub's root `.gitignore` lacks `.sirius/`.

## Data
Written (only these):
- `<hub>/.sirius/journal.jsonl`: append-only, one zod-validated JSON object per line (`session`, `commit`, `triage`).
  Invalid lines are skipped and counted, never rewritten.
- `<hub>/.sirius/active.json`: the running timer (atomic write, deleted on stop).
- `<hub>/.sirius/triage.json`: derived file for `pick_today.py` (see below).
- `<hub>/.sirius/.gitignore`: privacy guard.
- `<hub>/.sirius/aliases.json`: optional, written by the learner: `{"<subject key>": ["alias", ...]}`.
- `<hub>/Roadmaps/weekly_reviews/<YYYY>-W<ww>.md`: only with `write: true`; followed by a best-effort, detached
  `smart-drive update <folder> --quiet` (ecosystem contract "post-write-hook"). Never for `.sirius/`.

Read: `ACTIVE_LEARNING.md`, `TASKS.md` and every project board, `Roadmaps/MASTER_ROADMAP.md`, `.vega/cards.json`,
`.vega/reviews.jsonl`, Orion `lab.json` and `orion-attempts.jsonl`, Aurora `progress.jsonl` and
`aurora-progress-*.jsonl` (Mira events are the ones whose `slideId` starts with `mira-stop-`), Polaris `errorlog.md`,
`reviews.json` and `schedule.json`, `git log`, and `%USERPROFILE%/.constellation/ecosystem.json` for tooling repos.

## Modules (src/)
`util` (dates in local time, countdown, tokenizer, process runner), `schema` (zod records), `hub` (ACTIVE_LEARNING
parser, subjects and aliases, board discovery, task lines, cross-board duplicate merge), `deadlines` (items, buckets,
conflicts, report), `triage` (suggest, record, list, triage.json), `plan` (MASTER_ROADMAP parser), `journal` (journal,
timer, commitments), `today`, `evidence` (read-only readers), `smartdrive` (search and post-write hook), `week` (weekly
review, stats), `guide`, `index` (server, CLI).

## Tools (10) and CLI
`sirius_guide`, `sirius_deadlines`, `sirius_triage` (suggest, record, list), `sirius_today`, `sirius_commit`,
`sirius_start`, `sirius_stop`, `sirius_log`, `sirius_week`, `sirius_stats`. The CLI mirrors them (`deadlines`, `today`,
`triage`, `commit`, `start`, `stop`, `log`, `week`, `stats`, `guide`, `version`, `help`; `--hub`, `--now`, `--json`).
Hub resolution: `hub` param, `SIRIUS_HUB`, `POLARIS_HUB`, `D:/02_Learning_Knowledge`. Clock: `now` param,
`SIRIUS_NOW`, system time; all arithmetic in the machine's local time zone; ISO weeks Monday..Sunday.

## Design notes
- Deadline rule (AGENTS.md): overdue (warn first), under 24 h (exact countdown, focus plan), under 48 h, under 72 h,
  later. Countdown text: `còn 23 giờ 12 phút`, `còn 2 ngày 5 giờ`, `quá hạn 16 ngày 1 giờ`, `quá hạn 40 phút`.
- Hub layout: `Directory:`, `Tasks:` and `Roadmap:` values in `ACTIVE_LEARNING.md` may be `file:///` links (the hub's own
  format), absolute paths, or paths relative to the hub; router-table links in `TASKS.md` likewise.
- Items: unchecked task lines with a Deadline from all boards (fenced code and checked lines ignored; no time means
  23:59), project deadlines, and today's goal. A project or goal item is dropped when a task has the same subject and
  deadline minute (the task gets `alsoIn`).
- Cross-board duplicates (spec addendum A1): task lines with the same normalised text (lowercase, no diacritics, no
  leading `<Subject>:` prefix, no backticks) and the same raw deadline string are merged; the project-board copy is kept,
  then central, then the watchlist; `alsoIn: ["ACTIVE_LEARNING.md:39"]`. A triage decision on the kept id covers the
  merged item. On the real hub this turns 64 overdue lines into 62.
- Conflicting deadlines (A2): two lines of one subject with content-token Jaccard >= 0.6 but different deadlines. Added
  guard: if both lines carry standalone numbers or codes they must agree, so "Buổi 1" and "Buổi 2" are siblings, not a
  conflict.
- Triage suggestions: the spec rule (Jaccard >= 0.2, or an explicit "thay ..." within 6 tokens) plus two guards that
  were added after the first real-hub run showed sibling tasks of one sequence ("Chủ đề 01" vs "Chủ đề 03", two Kaggle
  datasets) being proposed as replacements: numbers must agree, and at least one shared token must be rare (at most 3
  lines of the subject contain it). The explicit "thay" signal bypasses both guards. On the real hub the superseded
  suggestions dropped from 8 (mostly sibling tasks) to 3 plausible ones (Ridge/Lasso via its "thay" marker, the
  hyperparameter-tuning task, the stroke pipeline replaced by Capstone A).
- `triage.json` (A3): latest decision per task id that currently excludes the task (superseded, parked, snoozed with
  `until >= today`), with the current `file`, `line`, `raw` line, `deadlineRaw`, `text`, `decision`, `until`,
  `replacedBy`, `note`, `at`, and `copies` for merged duplicates. Rewritten after every `record`, refreshed by `list`
  (heals after manual edits; orphaned decisions drop out). Written as pure ASCII (non-ASCII escaped) so a reader with the
  wrong default encoding still matches `raw`.
- Commitments: kept if a session of the same subject starts within [time - 30 min, time + 90 min]; late if a linked
  session falls outside the window or a later session starts that day; missed when the day is over without a session;
  pending otherwise. A running timer counts as a started session.
- Today router: priorities first (overdue P0, anything under 24 h, P0 under 72 h), then the weekly template with this
  week's milestone and one "Bước tiếp theo" per subject (Polaris schedule, Vega due, failing Orion lab, otherwise the
  project's Next Action), due reviews, commitments, running timer, minutes learned versus the daily minimum
  (`SIRIUS_DAILY_MIN`, default 25).
- Weekly review: study versus budget, per-subject table with evidence (Orion, Vega, Aurora, `Mira dò code a/b đúng`,
  Sổ lỗi, Polaris reviews, commits), plan versus actual per day, estimate ratio (median actual / estimate, needs 3
  samples), deadlines and principle 7, study versus infrastructure time, Sunday ritual, source notes, and a shareable
  summary of at most 5 plain lines without file paths.
- Capacity-true budget (E1, planning fallacy): median weekly study hours of the last 3 completed ISO weeks with logged
  study sessions (needs 2); when the plan's weekly budget minimum exceeds 1.5 times that median the review says so.
- Streak tolerant to one miss (E2): qualifying day = a non-meta session of at least 10 minutes; walking back from today
  (today counts only once it has one), one empty day is tolerated, two consecutive empty days end the chain; also reports
  study days in the last 14 days.

## Tests
`node scripts/e2e.mjs` builds a fake hub under `%TEMP%` (boards with an overdue v1 task and its `(thay task ...)`
replacement, a task due in 5 h, a P0 in 30 h, one in 60 h, one in 10 days, a line without Priority, a checked overdue
task, a task in a fenced block, cross-board duplicates, conflicting deadlines, a CRLF board, MASTER_ROADMAP with the
unknown label AMD, Vega, Polaris, an Orion lab, Aurora and Mira events, a hub git repo plus a nested repo and tooling
repos) and drives the server over real MCP stdio plus the CLI: tools and annotations, guide topics, countdown and ISO
week helpers, plan cell parsing and year crossing, deadlines (buckets, dedupe, merge, conflicts, deviations, JSON),
triage (suggest, `before`, record errors, snooze, list, orphans, `triage.json` byte-for-byte `raw`, heal after edits),
today (template, priorities, next steps, daily minimum), commitments and timer, estimates, capacity, share summary,
weekly review file, stats and the tolerant streak, SmartDrive post-write hook through a fake `smart-drive`, the
`.sirius/.gitignore` privacy guard (and `git status --ignored`), the invariant that every fixture markdown file keeps its
sha256, and a scan for emoji.

## Status
- 2026-10-12: v0.1 implemented and verified. `build --check`: types OK. e2e: 260 ok, 0 FAIL (deterministic over
  repeated runs and under TZ=UTC). Read-only run against the real hub: 62 overdue after merging duplicates, 1 urgent
  (`Python_Master/TASKS.md:68`, merged with its project block), MASTER_ROADMAP parsed with no warnings.
- Follow-ups for the coordinator: optionally add `.sirius/` to the hub root `.gitignore` (the in-folder `.gitignore`
  already keeps it out of git), and register the server in the agents via Constellation. `pick_today.py` reads
  `.sirius/triage.json` (contract in `guide/GUIDE.md`, section 4).
