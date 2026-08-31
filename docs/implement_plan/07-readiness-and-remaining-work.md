# Molt — Readiness Review and Remaining Implementation Plan

This addendum records the first full review of the implemented `@molt/runtime` core and the work required before P1 can be considered complete. It is subordinate to the design notes and plans 00–06. It does not relax an invariant or convert a failing gate into a pass.

## Review boundary and evidence

Review date: 2026-08-31. The review covered the source tree, design notes 01–08, plans 00–06, the ledger, CI configuration, public API review output, and the test suites. No production implementation was changed during this review.

The current worktree already contains user changes in `packages/runtime-core/test/property/resolver.test.ts` and `packages/runtime-core/test/toolchain.test.ts`; those changes are preserved.

| Area                 | Result                                | Meaning                                                                                                                                  |
| -------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm verify`        | Green                                 | Typecheck, lint, and knip pass for the current tree.                                                                                     |
| `pnpm test`          | Green: 274 tests                      | Unit, DOM, and transaction tests pass; this does not cover the failing property/stress paths.                                            |
| `pnpm test:coverage` | Green: 91.75% lines / 80.69% branches | Thresholds pass, but coverage is not evidence that the property/stress failures are resolved.                                            |
| `pnpm check:arch`    | Green                                 | Current dependency-cruiser rules pass.                                                                                                   |
| `pnpm build`         | Green                                 | Dual ESM/CJS build succeeds.                                                                                                             |
| `pnpm check:pkg`     | Green                                 | `publint` and `attw` pass.                                                                                                               |
| `pnpm check:api`     | Exit 0 with warnings                  | API review is generated but still needs warning cleanup and human sign-off.                                                              |
| `pnpm test:property` | Red                                   | Resolver oracle direction and lifecycle disposal-event behavior require correction; the run also exposed core resolution/disposal risks. |
| `pnpm test:stress`   | Red: 3 of 4 files                     | Two fixtures do not publish their declared capability; the soak generator creates invalid capability IDs.                                |
| Remote CI / P0-A1    | Blocked externally                    | GitHub organization/repository creation, first push, and branch protection require the owner’s browser.                                  |

## Release blockers found

These are ordered by correctness risk. The first four must be addressed before spending effort on adapters or publication work.

### R0. Reconcile the contract before changing behavior

The implemented code and documents are not fully synchronized. Resolve these questions in a short ADR or same-change note amendment before implementation:

1. Does resolution validate only the root dependency closure, or every installed definition? The current resolver processes every definition, while the runtime API is root-start oriented.
2. Does `Runtime.dispose()` emit `stopped` events for active generations, or only the final `disposed` event? The property model currently expects the former.
3. What is the exact replacement failure shape? The contract requires `REPLACEMENT_FAILED`; the underlying resolution/validation cause must remain inspectable without publishing candidate state.
4. Which exposed types are intentionally public? `MoltErrorInit` and `BlockedDiagnostic` are referenced by public signatures but are currently reported by API Extractor as forgotten exports.
5. Which snapshot guarantee is promised: immutable owned metadata, or recursively frozen values? Opaque contribution values are host-owned and must not be recursively frozen; the distinction must be explicit.

Update the affected design notes, plan text, tests, and ledger entry in the same change as each decision. Do not make a failing test pass by silently changing the contract.

### R1. Make provider selection consumer-specific

`resolver.ts` currently stores selection by capability ID alone. If two consumers require the same capability ID with different semver ranges, the later resolution overwrites the earlier selection. The runtime then reads a provider that may not satisfy the requesting consumer, or reports that a valid binding disappeared.

Implementation sequence:

1. Key internal selections by `(consumer plugin ID, capability ID)` (or an equivalent nested map).
2. Keep multi-provider aggregation and deterministic ordering within each consumer’s selection.
3. Make runtime requirement lookup and reverse-edge recording use the consumer-specific selection.
4. Preserve host-first, then plugin-ID ordering where the same requirement has multiple valid providers.
5. Add direct resolver and runtime regressions for two consumers with disjoint ranges, for single- and multi-provider tokens, and for permutation determinism.
6. Re-run the reference model after the representation change; the model must assert the same per-consumer binding, not merely the same provider set.

Acceptance: a provider selected for one consumer cannot satisfy another consumer unless it satisfies that consumer’s range and policy. INV-10 and INV-11 remain true after every operation.

### R2. Make replacement preparation a real isolated resolution

The replacement candidate path currently prepares a candidate context without the active resolution plan. Its requirement lookup can therefore hand the candidate an incompatible active provider. It also lacks the host-provider conflict preflight that normal installation performs, so a candidate can publish a single-valued capability already owned by the host.

Implementation sequence:

1. Build a candidate-specific provider view from host providers plus active plugin generations.
2. Filter every candidate requirement by token ID, semver range, optionality, and single/multi policy.
3. Reject missing, incompatible, ambiguous, and host-conflicting bindings before candidate publication or externally visible setup effects.
4. Keep old-generation state untouched until candidate preparation and validation succeed.
5. Wrap candidate failures as `REPLACEMENT_FAILED` while retaining the structured underlying cause and path.
6. Add tests for incompatible ranges, host conflicts, ambiguous providers, candidate setup failure, candidate validation failure, and successful replacement with active dependents.

Acceptance: failed replacement leaves the old generation active and usable; candidate capabilities and contributions are absent; candidate-owned resources are disposed; no candidate provider is visible in inspection or dependency edges.

### R3. Close the runtime-disposal/preparing race

`Runtime.dispose()` marks the runtime disposed and tears down active generations, but an in-flight preparation can later commit an active generation after disposal. A deterministic deferred-setup test reproduced this: disposal completed while the plugin remained preparing, then releasing the setup gate allowed it to become active with no disposer call.

Implementation sequence:

1. At disposal call time, synchronously mark the runtime closed and abort every preparing scope.
2. Ensure queued and in-flight lifecycle operations observe the closed state and reject without publishing.
3. Add a commit-time closed/aborted check immediately before publication and active-state transition.
4. Await all relevant operation tails and preparation promises before reporting final disposal completion, without creating a queue cycle.
5. Dispose active generations in reverse activation order, continue after failures, and aggregate diagnostics according to the decided event contract.
6. Add deterministic deferred tests for disposal during setup, queued start during disposal, replacement during disposal, double disposal, and late candidate completion.

Acceptance: after `await runtime.dispose()`, no future microtask can publish capabilities, contributions, active status, or disposal work for a generation that was still preparing. INV-05, INV-06, INV-07, INV-08, and INV-14 remain true.

### R4. Make inspection and error snapshots genuinely safe

The outer inspection object is frozen, but exposed `MoltError` and diagnostic records remain mutable. Mutating an error or diagnostic obtained from one inspection changes later inspections. A `Map` snapshot is isolated by copying its entries, but freezing a `Map` does not freeze its internal storage; the promised boundary must be documented and tested.

Implementation sequence:

1. Freeze or defensively clone every core-owned error, diagnostic, path, details object, provider record, and event payload exposed through inspection.
2. Keep opaque contribution values host-owned; do not deep-freeze arbitrary plugin values.
3. Define and test `ContributionSnapshot` map isolation explicitly, preferably with an API that does not imply that `Object.freeze(map)` freezes map operations.
4. Add mutation-attempt tests for `MoltError`, nested diagnostic details, plugin records, provider lists, event payloads, and contribution snapshots.

Acceptance: an inspection or observer payload is a stable snapshot and cannot mutate runtime state or future snapshots through any owned nested object. INV-06 and ADR-08 are covered.

### R5. Complete defensive validation and strict-code cleanup

The review also found smaller but binding quality issues:

- `internal/async.ts` uses non-null assertions in `createDeferred`, prohibited by the repository rules.
- Resolver input validation does not fully reject malformed versions and malformed token flags when called with forged JavaScript objects.
- Definition validation treats some `null` fields as absent despite exact optional semantics.
- API Extractor reports forgotten public types, missing package documentation, and incomplete member documentation.
- TSDoc contains unclosed backticks in `definition.ts`.

Fix these after R1–R4, with focused tests for each rejected shape and exact `MoltError` code. Resolve the public-type decision from R0 before changing exports. Regenerate the API file and obtain human review; an exit code of zero with warnings is not the P1-E11 Definition of Done.

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

Do not tick P1-E7, P1-E8, P1-E9, or P1-E11 merely because the suites or wiring exist. Each remains open until its required run and review evidence is attached. P0-A1 remains a separate external prerequisite for remote CI and branch protection.

## P2–P5 implementation roadmap after P1

### P2 — test kit and independent hosts

Build `@molt/test` first: fake resources, cue-based failures, leak assertions, generation disposal assertions, and a plugin harness. Then create `examples/command-host` and `examples/worker-host` using independent application code. Run the same replacement, cascade, disposal, and leak suite against both hosts. Add mutation testing only after the deterministic suite is stable.

Exit condition: both hosts demonstrate the core guarantees without importing one another or relying on shared application globals.

### P3 — adapters and evidence

Implement and gate one adapter at a time: `@molt/events`, `@molt/react`, `@molt/vite`, then `@molt/sqlite`. Each adapter needs an explicit mapping from adapter failure to core error/event behavior, scope-owned cleanup, stale-generation protection, and forced-failure tests using `@molt/test`.

After the adapters, build `demo/comparison` with naive registry, pinned Cordis, and Molt runners. `pnpm bench` must regenerate both `RESULTS.md` and machine-readable JSON. Add the Playwright happy/replacement smoke and the release-branch benchmark artifact job. The root README currently links to comparison results that do not yet exist; the link is only valid after this deliverable lands.

### P4 — Sky integration

Begin with a source inventory of the current Sky plugin registry, UI registration path, and database ownership boundary. That inventory is required before assigning exact bridge files: this repository currently contains the Molt runtime but not the Sky implementation. Build a thin transitional bridge, route UI through `@molt/react`, route database access through `database.connection`, then remove the global registry from the library path. Mark the compatibility layer transitional in code and documentation.

Exit condition: Sky runs on Molt while manifests, policy, and host-owned concerns remain in Sky.

### P5 — publication

Before publishing, add and dry-run the changesets release pipeline, trusted publishing/provenance, and `release.yml`. Complete the evidence checklist only after P1–P4 are green: published core gates, two unrelated hosts, Sky integration, regenerated comparison results, documented limitations, and zero invariant failures or an explicitly reviewed waiver. A publication decision to remain internal is valid if the evidence is not sufficient.

## Definition of Done for the remaining work

Every item is complete only when all four conditions hold:

1. The implementation is present and has no stub, hidden fallback, global registry, unsafe assertion, or undocumented public behavior.
2. Tests are named against the relevant INV or plan section and cover success, failure, concurrency, cleanup, and snapshot boundaries.
3. Design notes, implementation plans, README claims, API review files, and the ledger agree with the delivered behavior.
4. The applicable G1–G10 gates are green in the supported environment matrix, with the command, seed, artifact, and review evidence recorded.
