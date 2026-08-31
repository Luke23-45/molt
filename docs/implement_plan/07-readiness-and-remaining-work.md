# Molt — Readiness Review and Remaining Implementation Plan

This addendum records the first full review of the implemented `@molt/runtime` core and the work required before P1 can be considered complete. It is subordinate to the design notes and plans 00–06. It does not relax an invariant or convert a failing gate into a pass.

## Review boundary and evidence

Review date: 2026-08-31. The review covered the source tree, design notes 01–08, plans 00–06, the ledger, CI configuration, public API review output, and the test suites. The corrective implementation and revalidation changes recorded below are part of this worktree.

The current worktree already contains user changes in `packages/runtime-core/test/property/resolver.test.ts` and `packages/runtime-core/test/toolchain.test.ts`; those changes are preserved.

| Area                 | Result                                | Meaning                                                                                                 |
| -------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `pnpm verify`        | Green                                 | Typecheck, lint, and knip pass for the current tree.                                                    |
| `pnpm test`          | Green: 290 tests                      | Unit, DOM, and transaction tests pass.                                                                  |
| `pnpm test:coverage` | Green: 91.51% lines / 80.46% branches | Package-local thresholds pass; property and stress suites are separately green below.                   |
| `pnpm check:arch`    | Green                                 | Current dependency-cruiser rules pass.                                                                  |
| `pnpm build`         | Green                                 | Dual ESM/CJS build succeeds.                                                                            |
| `pnpm check:pkg`     | Green                                 | `publint` and `attw` pass.                                                                              |
| `pnpm check:api`     | Green, warning-free                   | API report matches the built public declarations; the surface was manually checked against plan 03 §10. |
| `pnpm test:property` | Green after correction                | The resolver oracle and lifecycle model were corrected, then rerun with fixed and random seeds.         |
| `pnpm test:stress`   | Green: 3 files / 4 tests              | Resolution budget, leak, replacement-failure, and bounded-soak checks pass.                             |
| Remote CI / P0-A1    | Blocked externally                    | GitHub organization/repository creation, first push, and branch protection require the owner’s browser. |

## Release blockers found

These are ordered by correctness risk. The first four must be addressed before spending effort on adapters or publication work.

### R0. Reconcile the contract before changing behavior

The implemented code and documents are not fully synchronized. Resolve these questions in a short ADR or same-change note amendment before implementation:

1. Resolution validates every installed definition for a deterministic global plan, while activation order is the root's dependency closure. This preserves the plan's all-definition validation rule and the runtime's root-start API.
2. `Runtime.dispose()` emits only the final `disposed` event after teardown; it does not synthesize per-plugin `stopped` events. This is the terminal runtime event contract.
3. Replacement failures are always structured `REPLACEMENT_FAILED` errors; the underlying validation or resolution cause remains in `cause` and candidate state is never published.
4. `MoltErrorInit` and `BlockedDiagnostic` are intentionally public because they occur in public signatures and are exported from `index.ts`.
5. Snapshots recursively freeze runtime-owned metadata and containers, while opaque host-owned values and throwable causes are isolated by reference and are not recursively frozen.

Update the affected design notes, plan text, tests, and ledger entry in the same change as each decision. Do not make a failing test pass by silently changing the contract.

### R1. Make provider selection consumer-specific

The original implementation stored selection by capability ID alone. If two consumers require the same capability ID with different semver ranges, the later resolution overwrote the earlier selection. The runtime then read a provider that might not satisfy the requesting consumer.

Implementation sequence:

1. Key internal selections by `(consumer plugin ID, capability ID)` (or an equivalent nested map).
2. Keep multi-provider aggregation and deterministic ordering within each consumer’s selection.
3. Make runtime requirement lookup and reverse-edge recording use the consumer-specific selection.
4. Preserve host-first, then plugin-ID ordering where the same requirement has multiple valid providers.
5. Add direct resolver and runtime regressions for two consumers with disjoint ranges, for single- and multi-provider tokens, and for permutation determinism.
6. Re-run the reference model after the representation change; the model must assert the same per-consumer binding, not merely the same provider set.

Acceptance: a provider selected for one consumer cannot satisfy another consumer unless it satisfies that consumer’s range and policy. INV-10 and INV-11 remain true after every operation.

### R2. Make replacement preparation a real isolated resolution

The original replacement candidate path prepared a candidate context without the active resolution plan. Its requirement lookup could therefore hand the candidate an incompatible active provider. It also lacked the host-provider conflict preflight that normal installation performs, so a candidate could publish a single-valued capability already owned by the host.

Implementation sequence:

1. Build a candidate-specific provider view from host providers plus active plugin generations.
2. Filter every candidate requirement by token ID, semver range, optionality, and single/multi policy.
3. Reject missing, incompatible, ambiguous, and host-conflicting bindings before candidate publication or externally visible setup effects.
4. Keep old-generation state untouched until candidate preparation and validation succeed.
5. Wrap candidate failures as `REPLACEMENT_FAILED` while retaining the structured underlying cause and path.
6. Add tests for incompatible ranges, host conflicts, ambiguous providers, candidate setup failure, candidate validation failure, and successful replacement with active dependents.

Acceptance: failed replacement leaves the old generation active and usable; candidate capabilities and contributions are absent; candidate-owned resources are disposed; no candidate provider is visible in inspection or dependency edges.

### R3. Close the runtime-disposal/preparing race

The original `Runtime.dispose()` marked the runtime disposed and tore down active generations, but an in-flight preparation could later commit an active generation after disposal. A deterministic deferred-setup test reproduced this: disposal completed while the plugin remained preparing, then releasing the setup gate allowed it to become active with no disposer call.

Implementation sequence:

1. At disposal call time, synchronously mark the runtime closed and abort every preparing scope.
2. Ensure queued and in-flight lifecycle operations observe the closed state and reject without publishing.
3. Add a commit-time closed/aborted check immediately before publication and active-state transition.
4. Await all relevant operation tails and preparation promises before reporting final disposal completion, without creating a queue cycle.
5. Dispose active generations in reverse activation order, continue after failures, and aggregate diagnostics according to the decided event contract.
6. Add deterministic deferred tests for disposal during setup, queued start during disposal, replacement during disposal, double disposal, and late candidate completion.

Acceptance: after `await runtime.dispose()`, no future microtask can publish capabilities, contributions, or active status for a generation that was still preparing. If suspended setup later returns an owned disposer, it is still run once as late cleanup; it cannot commit state. INV-05, INV-06, INV-07, INV-08, and INV-14 remain true.

### R4. Make inspection and error snapshots genuinely safe

The original outer inspection object was frozen, but exposed `MoltError` and diagnostic records remained mutable. Mutating an error or diagnostic obtained from one inspection could change later inspections. A `Map` snapshot is isolated by copying its entries, but freezing a `Map` does not freeze its internal storage; the boundary is now documented and tested.

Implementation sequence:

1. Freeze or defensively clone every core-owned error, diagnostic, path, details object, provider record, and event payload exposed through inspection.
2. Keep opaque contribution values host-owned; do not deep-freeze arbitrary plugin values.
3. Define and test `ContributionSnapshot` map isolation explicitly, preferably with an API that does not imply that `Object.freeze(map)` freezes map operations.
4. Add mutation-attempt tests for `MoltError`, nested diagnostic details, plugin records, provider lists, event payloads, and contribution snapshots.

Acceptance: an inspection or observer payload is a stable snapshot and cannot mutate runtime state or future snapshots through any owned nested object. INV-06 and ADR-08 are covered.

### R5. Complete defensive validation and strict-code cleanup

The review found smaller but binding quality issues; the corrective pass addressed each one:

- `internal/async.ts` uses non-null assertions in `createDeferred`, prohibited by the repository rules.
- Resolver input validation does not fully reject malformed versions and malformed token flags when called with forged JavaScript objects.
- Definition validation treats some `null` fields as absent despite exact optional semantics.
- API Extractor reports forgotten public types, missing package documentation, and incomplete member documentation.
- TSDoc contains unclosed backticks in `definition.ts`.

The focused tests now cover each rejected shape and exact `MoltError` code. The public-type decision is reflected in the exports, the API file was regenerated and manually checked against plan 03 §10, and `check:api` is warning-free.

## P1 revalidation sequence

The implementation order is deliberately narrower than the future package roadmap:

| Order | Work item                                             | Required proof                                                                                                                 |
| ----- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1     | R0 contract and note synchronization                  | Updated notes/plan/tests agree; ledger task exists before code changes.                                                        |
| 2     | R1 consumer-specific resolver selections              | Direct regressions, resolver property, model-based lifecycle run.                                                              |
| 3     | R2 replacement preflight and candidate plan           | T-R2/T-R3/T-R9 plus incompatible-range, host-conflict, and dependent cases.                                                    |
| 4     | R3 disposal race and teardown ordering                | Deferred deterministic tests, T-R4/T-R8, no post-dispose publication.                                                          |
| 5     | R4 snapshot immutability                              | Inspection/error/event mutation tests.                                                                                         |
| 6     | R5 validation, TSDoc, and forbidden-construct cleanup | `pnpm verify`, `pnpm check:api` without warnings, API human review.                                                            |
| 7     | Correct the property/stress harness                   | Resolver edge assertion direction, lifecycle model event contract, capability publication in fixtures, grammar-valid soak IDs. |
| 8     | Full P1 evidence run                                  | `pnpm verify`, unit + coverage, property, stress, build, arch, package, API, and remote matrix.                                |

Do not tick P1-E7, P1-E8, P1-E9, or P1-E11 merely because the suites or wiring exist. E7, E8, and E11 have local evidence but remain formally open until the PR-linked ledger update; E9 remains open until remote CI runs. P0-A1 remains a separate external prerequisite for remote CI and branch protection.

## P2–P5 implementation roadmap after P1

### P2 — test kit and independent hosts — implemented

`@molt/test` now provides fake listener/timer/connection resources, deterministic create/dispose failure cues, leak assertions, generation-disposal assertions, and a public-API plugin harness. `examples/command-host` and `examples/worker-host` use independent application code and each runs replacement and leak tests.

Exit condition: both hosts demonstrate the core guarantees without importing one another or relying on shared application globals.

### P3 — adapters and evidence — implemented locally

The four adapters are implemented and have forced-failure tests: scoped typed events, committed React snapshots/error isolation/stale callback guards, a host-neutral HMR bridge, and checksum-verified SQLite migrations with explicit host destruction. Their package-local tests run without core-internal imports.

`demo/comparison` now runs naive-registry, pinned Cordis `4.0.0-rc.9`, and Molt runners; `pnpm bench` regenerates `RESULTS.md` and machine-readable JSON. The Playwright happy/replacement smoke and release-branch benchmark artifact job are wired. The Cordis row intentionally uses its direct dispose-then-activate baseline because its direct Fiber API does not provide Molt's transactional replacement primitive.

### P4 — Sky integration — out of scope

Sky integration is intentionally removed from this repository's remaining
work. This repository does not contain the Sky implementation and will not
inventory or migrate it. A downstream Sky project may consume Molt later, but
that bridge, UI/database migration, registry replacement, and transitional
compatibility policy are outside this project's scope.

### P5 — publication

The Changesets configuration, initial release changeset, trusted-publishing
workflow, non-publishing dry run, evidence checklist, and positioning review
are implemented in [`docs/release-readiness.md`](../release-readiness.md).
Publication remains a separate P5 decision based on the two independent hosts,
regenerated benchmark evidence, documented limitations, and the full release
gates. A publication decision to remain internal is valid.

## Definition of Done for the remaining work

Every item is complete only when all four conditions hold:

1. The implementation is present and has no stub, hidden fallback, global registry, unsafe assertion, or undocumented public behavior.
2. Tests are named against the relevant INV or plan section and cover success, failure, concurrency, cleanup, and snapshot boundaries.
3. Design notes, implementation plans, README claims, API review files, and the ledger agree with the delivered behavior.
4. The applicable G1–G10 gates are green in the supported environment matrix, with the command, seed, artifact, and review evidence recorded.
