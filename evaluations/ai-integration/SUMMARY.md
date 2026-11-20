# AI integration evaluation results summary

English | [中文](SUMMARY_CN.md) | [Tasks and scoring](README.md)

Two `ai-integration-v1` runs completed on 2026-11-20. Each used 12 tasks with three
independent projects and fresh sessions: 36 valid attempts and no environment blockers.
Agents could read documentation and compile before first delivery. Failures received
at most two raw-diagnostic repairs: 600 seconds initially and 300 seconds per repair.

| Metric | First run | After the Schema Recipe |
| --- | --- | --- |
| First delivery pass | 28/36 (77.8%) | 32/36 (88.9%) |
| Final within two repairs | 34/36 (94.4%) | 35/36 (97.2%) |
| AI-11 first delivery | 0/3 | 3/3 |
| AI-11 final | 1/3 | 3/3 |
| Unresolved attempts | AI-11-r1, AI-11-r3 | AI-02-r2 |

| Task | First run initial / final | Recipe run initial / final |
| --- | --- | --- |
| AI-01 | 3/3 · 3/3 | 3/3 · 3/3 |
| AI-02 | 1/3 · 3/3 | 2/3 · 2/3 |
| AI-03 | 3/3 · 3/3 | 3/3 · 3/3 |
| AI-04 | 3/3 · 3/3 | 3/3 · 3/3 |
| AI-05 | 2/3 · 3/3 | 3/3 · 3/3 |
| AI-06 | 3/3 · 3/3 | 3/3 · 3/3 |
| AI-07 | 3/3 · 3/3 | 3/3 · 3/3 |
| AI-08 | 1/3 · 3/3 | 1/3 · 3/3 |
| AI-09 | 3/3 · 3/3 | 3/3 · 3/3 |
| AI-10 | 3/3 · 3/3 | 2/3 · 3/3 |
| AI-11 | 0/3 · 1/3 | 3/3 · 3/3 |
| AI-12 | 3/3 · 3/3 | 3/3 · 3/3 |

Initial AI-11 failures involved widened enum types, readonly line elements from
whole-fragment `as const`, and treating enum metadata as runtime validation.
The compiled [Schema Recipe](../../packages/model-reaction/examples/SCHEMA_COMPOSITION.md)
combines these contracts in fragment factories and domain functions. All three new
attempts read and adopted it, retained the required exact types and passed first delivery.

Other scenarios did not uniformly improve. New AI-02-r2 returned a facade and
retained a forbidden type assertion after repairs. AI-08 feedback/input-error gating
and AI-10 selector equality/error subscriptions still produced first-delivery failures.
In the first run, evaluator code review caught AI-05-r1's indirect any, an automated
false negative. The existing no-type-escape rule adjusted the initial automated
29/36 score to 28/36; that attempt passed after two repairs.

Tasks, starters, reference solutions, acceptance and budgets matched across runs.
Both used Codex CLI 0.163.0, gpt-6-luna, medium reasoning, Chinese prompts,
Node v24.16.0, npm 12.2.0, TypeScript 5.9.3 and React 19.3.0. Runtime/declaration
files were identical, as were other locked dependencies. Resampling additionally
isolated prior temporary projects. Targets were source commit
`8678594c9f0b6f828d97258f6b01a4aaf0f785fa` plus each working-tree diff. Both packages
were labeled 1.2.0 with unreleased behavior; they do not represent the same-version npm release.

| Package | Tarball SHA-256 |
| --- | --- |
| First run | `ecb40d684565d24b91bb5662109a7b1d52c1284fbc15f4733b201e362ca81652` |
| Recipe run | `fbc8756fff2d00da75dbec957a8c467a4beac747f074b4727e030f38b3300061` |

This summary is versioned. Full reports, manifests, snapshots, logs and packages
remain local in `runs/baseline-v1/` and `runs/schema-recipe-v1-20261120/`, excluded
from Git and unavailable in a fresh clone. Archive complete evidence separately.
Use the [execution guide](EXECUTION.md) for a new run.

Three samples per task and a Recipe closely matching AI-11 do not establish
generalization to other domains or a causal documentation effect. The provider
exposes no immutable model snapshot. React uses jsdom; real-browser submission,
complete SKIP scheduling semantics, IME, cancellation and stale action writeback
are not fully covered.
