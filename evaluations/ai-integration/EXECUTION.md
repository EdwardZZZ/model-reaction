# Run the AI integration evaluation

English | [中文](EXECUTION_CN.md)

See the [baseline](README.md) for tasks and scoring. This runner evaluates Codex
CLI implementations in standalone consumer projects. Library tests are not
substituted for agent results.

The framework and [results summary](SUMMARY.md) are versioned. Reports, packages,
logs and session evidence in `runs/` are Git-ignored and not included in clones;
the commands below generate new historical-target artifacts. The original
measurements and SUMMARY numbers are not rerun or rewritten by these fixes.

## Historical Target

The frozen v1 references target local version **1.2.0**, source commit
`8678594c9f0b6f828d97258f6b01a4aaf0f785fa`, not the npm release or current 2.0 API.
From the current repository root, create a separate source checkout and a fresh
output directory. Install that checkout's build dependencies separately before
preparation; preparation itself builds, packs and installs the consumer toolchain.
These are operator commands, not part of the offline regression probe:

```bash
SOURCE=/tmp/model-reaction-v1-source
OUT="$PWD/evaluations/ai-integration/runs/reproduction-v1-20261127"
git worktree add --detach "$SOURCE" 8678594c9f0b6f828d97258f6b01a4aaf0f785fa
pnpm --dir "$SOURCE" install --frozen-lockfile
node evaluations/ai-integration/lib/environment.mjs "$OUT" "$SOURCE"
node evaluations/ai-integration/calibrate.mjs "$OUT"
node evaluations/ai-integration/preflight.mjs "$OUT"
node evaluations/ai-integration/freeze.mjs "$OUT"
node evaluations/ai-integration/run.mjs AI-01 all "$OUT"
```

`prepare(output, sourceRepo = repo)` rejects a non-1.2.0 package before creating
output, building or installing. The default current checkout therefore fails
early. Version alone is not sufficient: verify `source_commit`, `source.diff`
and all 12 calibration results before sampling. Current-API evaluation requires
a separately versioned reference suite, not edits to these v1 references.

Run the last command for AI-01 through AI-12. `all` creates three fresh contexts;
`1`, `2`, or `3` selects one repetition. Attempts with an existing `result.json`
are not repeated. An existing project without a final result stops execution
for an evidence audit, avoiding silent resampling.

After every attempt finishes, inspect submitted code and diagnostics and save
the manual review in `$OUT/review.json`, then run:

```bash
node evaluations/ai-integration/report.mjs "$OUT"
```

The command checks frozen files, prompts, source snapshots and session independence,
then generates `RESULTS.json`, `REPORT_CN.md` and `REPORT.md`. Token totals use the
last stage's cumulative session counter for each attempt, not the sum of cumulative
counters before and after repairs. Reporting asserts first/last-stage consistency
with the attempt's initial/final statuses, and refuses existing report files.
The harness has changed; historical checks, fixtures, task acceptance, references
and scores have not. Original results are not regraded or rewritten. If manual
review discovers an existing constraint missed by automation, preserve `result.json`
and store adjudication plus remaining repairs in `reviewed-result.json`, which
the report prefers. AI-05-r1's implicit `any` followed this process without new
repetitions or additional repair allowance.

`review-types.mjs` now records inferred public value-export types using trusted
toolchain TypeScript inside the grading sandbox;
`continue-reviewed.mjs` returns that constraint diagnostic in the original session
with the same agent permissions and the current grading boundary. Exhausting the
repair budget after manual rejection leaves final status FAIL. The historical
aid to the existing manual-review rule was added after sampling began and must be
disclosed separately from these later isolation/status changes. The original inspector
source is archived under `runs/baseline-v1/review-tool-sources/`; subsequent whole-run
inspection excludes type-only exports to avoid falsely classifying interfaces as `any`.

Do not rerun preparation, calibration or freezing over existing measured evidence.
Use a new output directory for a new experiment and pass it to each command;
the `run.mjs` directory argument follows the repetition argument.

Prerequisites: Node, npm, pnpm and Codex CLI support for native named filesystem
permission profiles. Grading and offline probes do not need credentials or AI
calls; agent preflight/sampling require authentication. The initial configuration is recorded
in `runs/baseline-v1/manifest.json`. The model alias is `gpt-6-luna`, with medium
reasoning. The provider does not expose an immutable model snapshot; retain
that reproducibility limitation in reports.

`environment.mjs` builds the explicitly selected historical checkout and installs
its tarball. It records the actual package version and npm pack filename;
project creation and reporting consume `tarball_name`. Old manifests without
that field derive `model-reaction-${package_version}.tgz` (default historical
1.2.0 if the old version field is also absent). Verify
`environment.json.source_commit` against the baseline commit before sampling;
different source defines a different experiment. Consumer projects, CLI sessions,
and node_modules live in an isolated temporary directory. Durable evidence lives
under the selected output directory. Consumers share a locked, read-only toolchain and do
not map imports to library source.

`calibrate.mjs` runs all type, runtime, and automated constraint checks against
12 reference solutions. `preflight.mjs` verifies actual source writes,
compilation, denied repository/reference reads, denied immutable/toolchain
writes, denied external network access, and continuation of a repair session.
Preflights are excluded from the 36 business attempts. Agent preflight makes real
AI/network-denial probe calls; it is not the offline script below.

## Grading Boundary

All constraints, semantic inspection, compilation (120 seconds), and acceptance
(25 seconds) run inside a separate macOS native `codex sandbox -P evaluation`
worker, without an AI call. The parent imposes a 180-second total deadline and
8 MiB output limit, terminates the process group, and writes evidence itself.
There is no ordinary host-execution fallback.

The policy denies filesystem access by default, granting only the canonical
project (writable except fixed files), verified toolchain and suite `lib/` + `checks/` (read-only),
and the Node executable/system libraries and devices needed for startup.
Dependency symlinks outside the toolchain are rejected. A sanitized environment
and fresh local home prevent inherited credentials/configuration; CLI policy
resolution occurs outside the submission/repository. Network is disabled.
Before touching submitted source, the worker probes allowed access, denied
external/reference reads, a symlink escape, external/toolchain writes and
environment sanitation. Startup/probe failure is BLOCKED before compilation
or submitted-code execution, with raw status/signal/stderr in `sandbox.json`.
Do not widen permissions or bypass environment controls to make it start.

Checks execute in the same runtime as submissions and are readable inside the
worker. They are **not hidden or proof against adversarial tampering**. This
boundary protects host filesystem, environment and network access; it does not
make shared-runtime grading trustworthy against hostile submissions. Historical
grades ran in ordinary host children; their earlier agent permission probes do
not validate this new grading boundary.

## Offline Verification

```bash
node evaluations/ai-integration/probe-offline.mjs /tmp/model-reaction_audit_20261127
```

This bounded script creates a fresh evidence subdirectory, reuses the local
TypeScript installation, and tests final status/report rejection, the early
target guard, tarball plumbing and a denied synthetic marker. It performs no
build, install, agent call or network operation. Exit 0 means regression
assertions passed, including fail-closed behavior when sandbox startup is
unavailable; inspect the explicit sandbox status before claiming isolation.

In the current injected execution environment the native CLI fails to start
Node with exit 71: `sandbox-exec: execvp() ... failed: Operation not permitted`.
An earlier direct strict Seatbelt probe also failed (including SIGABRT). Neither
was bypassed. Native compile/runtime success and behavioral network denial
remain unverified here; network is disabled in the recorded policy. Do not
sample until capability probes and all references pass on a supported host.

After every submission, the runner freezes `src/` and grades it. Failures receive
raw compiler/assertion diagnostics for at most two repairs. Evaluator type assertions
and their compiled output are removed before repair. Prompts contain only the
Chinese baseline's shared/task prompt plus public starter interfaces, excluding
acceptance criteria and failure patterns.

| Path | Responsibility |
| --- | --- |
| `lib/tasks.mjs`, `fixtures/` | Public starters, service interfaces, prompt extraction |
| `references/` | Evaluator-owned solutions, hidden from the subject |
| `checks/` | Frozen type, core behavior and mounted React acceptance |
| `lib/grader.mjs` | Project creation, parent evidence and worker orchestration |
| `lib/sandbox.mjs`, `lib/worker.mjs`, `lib/semantic.mjs` | Native boundary, constrained grading and semantic inspection |
| `lib/agent.mjs` | Permissions, sessions, budgets, raw events and token accounting |
| `run.mjs` | Independent attempts and two diagnostic repair rounds |
| `report.mjs` | Evidence integrity checks, metrics and bilingual reports |
| `probe-offline.mjs` | Offline regression and native denied-marker probes |
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
