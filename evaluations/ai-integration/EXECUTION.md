# Run the AI integration evaluation

English | [中文](EXECUTION_CN.md)

See the [baseline](README.md) for tasks and scoring. This runner evaluates Codex
CLI implementations in standalone consumer projects. Library tests are not
substituted for agent results.

The framework and [results summary](SUMMARY.md) are versioned. Reports, packages,
logs and session evidence in `runs/` are Git-ignored and not included in clones;
the commands below generate those local artifacts for a new experiment.

From the repository root:

```bash
node evaluations/ai-integration/lib/environment.mjs
node evaluations/ai-integration/calibrate.mjs
node evaluations/ai-integration/preflight.mjs
node evaluations/ai-integration/freeze.mjs
node evaluations/ai-integration/run.mjs AI-01 all
```

Run the last command for AI-01 through AI-12. `all` creates three fresh contexts;
`1`, `2`, or `3` selects one repetition. Attempts with an existing `result.json`
are not repeated. An existing project without a final result stops execution
for an evidence audit, avoiding silent resampling.

After every attempt finishes, inspect submitted code and diagnostics and save
the manual review in `runs/baseline-v1/review.json`, then run:

```bash
node evaluations/ai-integration/report.mjs
```

The command checks frozen files, prompts, source snapshots and session independence,
then generates `RESULTS.json`, `REPORT_CN.md` and `REPORT.md`. Token totals use the
last stage's cumulative session counter for each attempt, not the sum of cumulative
counters before and after repairs. Reporting and manual review are separate from
the frozen grader; they do not regrade or rewrite original results. If manual
review discovers an existing constraint missed by automation, preserve `result.json`
and store adjudication plus remaining repairs in `reviewed-result.json`, which
the report prefers. AI-05-r1's implicit `any` followed this process without new
repetitions or additional repair allowance.

`review-types.mjs` records inferred public value-export types using TypeScript;
`continue-reviewed.mjs` returns that constraint diagnostic in the original session
with the same permissions and grader. This aid to the existing manual-review rule
was added after sampling began and must be disclosed. The original inspector
source is archived under `runs/baseline-v1/review-tool-sources/`; subsequent whole-run
inspection excludes type-only exports to avoid falsely classifying interfaces as `any`.

Do not rerun preparation, calibration or freezing over existing measured evidence.
Use a new output directory for a new experiment and pass it to each command;
the `run.mjs` directory argument follows the repetition argument.

Prerequisites: authenticated Codex CLI, Node, npm, pnpm, and CLI support for
named filesystem permission profiles. The initial configuration is recorded
in `runs/baseline-v1/manifest.json`. The model alias is `gpt-6-luna`, with medium
reasoning. The provider does not expose an immutable model snapshot; retain
that reproducibility limitation in reports.

`environment.mjs` builds the current checkout and installs its tarball. Verify
`environment.json.source_commit` against the baseline commit before sampling;
different source defines a different experiment. Consumer projects, CLI sessions,
and node_modules live in an isolated temporary directory. Durable evidence lives
under `runs/baseline-v1/`. Consumers share a locked, read-only toolchain and do
not map imports to library source.

`calibrate.mjs` runs all type, runtime, and automated constraint checks against
12 reference solutions. `preflight.mjs` verifies actual source writes,
compilation, denied repository/reference reads, denied immutable/toolchain
writes, denied external network access, and continuation of a repair session.
Preflights are excluded from the 36 business attempts. On macOS the runner uses
native CLI permissions to avoid nesting incompatible Seatbelt sandboxes; it
does not use full-access or sandbox-bypass options.

After every submission, the runner freezes `src/` and grades it. Failures receive
raw compiler/assertion diagnostics for at most two repairs. Hidden type assertions
and their compiled output are removed before repair. Prompts contain only the
Chinese baseline's shared/task prompt plus public starter interfaces, excluding
acceptance criteria and failure patterns.

| Path | Responsibility |
| --- | --- |
| `lib/tasks.mjs`, `fixtures/` | Public starters, service interfaces, prompt extraction |
| `references/` | Evaluator-owned solutions, hidden from the subject |
| `checks/` | Hidden types, core behavior, mounted React acceptance |
| `lib/grader.mjs` | Immutable files, static constraints, compilation and grading |
| `lib/agent.mjs` | Permissions, sessions, budgets, raw events and token accounting |
| `run.mjs` | Independent attempts and two diagnostic repair rounds |
| `report.mjs` | Evidence integrity checks, metrics and bilingual reports |
| `review-types.mjs`, `continue-reviewed.mjs` | Semantic review evidence and remaining repairs in the original session |
| `runs/*/manifest.json` | Source, package, prompt, fixture, check and config fingerprints |
| `runs/*/review.json` | Manual review, failure attribution, coverage limits and next steps |
| `runs/*/attempts/*/stage-*` | Every submission, raw events, compiler/runtime diagnostics |

Automated checks catch common type escapes, non-public imports, and impure/async
computed functions. Review submitted code for pure computations, ordinary library
usage, and accurate migration notes before accepting the final report. Controlled
Promises synchronize services; AI-04 advances 10ms debounce with a virtual clock.
The 20-second acceptance watchdog exposes missing barriers; elapsed time is never
treated as evidence that asynchronous work finished.
