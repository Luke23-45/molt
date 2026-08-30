# 04 — Test Plan

The value of Molt is failure behavior, so the suite is designed around failure (note [06](../notes/06-validation-and-release-gates.md)). This document is the complete inventory: every test class, the invariant it proves, and the gate it feeds. Nothing here is optional; the transaction tests are release blockers by note-06 decree.

## 1. Structure

Vitest projects defined in the root `vitest.config.ts` (Vitest 4 removed `vitest.workspace.ts`; amendment 00 §9):

| Project | Files | Runs in |
|---|---|---|
| `unit` | `test/*.test.ts` | node, happy-dom (both) |
| `property` | `test/property/*.test.ts` | node (fast-check, seeded runs) |
| `stress` | `test/stress/*.test.ts` | node |
| `adapters` | per-adapter packages (P3) | node + happy-dom |

Every test name references its invariant: `it('INV-07: failed candidate replacement leaves the old generation serving', …)`. A test without an INV or a spec section reference does not get merged.

## 2. Unit inventory (per module, mirrors [03](./03-core-implementation-spec.md))

### `scope.test.ts` — proves INV-01/02/03/04/05/12

1. acquisition + LIFO order with mixed sync/async disposers (INV-02)
2. disposer failure: later disposers still run, all errors collected (INV-03)
3. `dispose()` twice → one execution, same report (INV-05)
4. `acquire` after dispose → `INVALID_STATE` (INV-04)
5. `create` throws → nothing registered (INV-01 precondition)
6. abort during pending `create`: resolved value disposed immediately, acquire rejects (INV-01/12)
7. abort during pending `create` where create rejects → no double-dispose, error propagates wrapped
8. `onDispose` after dispose → `INVALID_STATE`
9. signal is aborted before disposers run (ordering assertion)
10. idempotent wrapper: throwing disposer memoized — second call does not re-run (INV-05)
11. empty scope dispose → report with zero errors, signal still aborted
12. concurrent dispose calls → both await one report (INV-05)
13. `Symbol.asyncDispose` parity with `dispose()` (ADR-09)

### `resolver.test.ts` — proves INV-10 and note-04 §Provider rules exhaustively

1. deterministic order under shuffled input permutation (×fast-check replay)
2. missing required capability → `MISSING_CAPABILITY`
3. incompatible-only candidates → `INCOMPATIBLE_CAPABILITY` with near-miss diagnostics
4. two compatible providers, single token → `AMBIGUOUS_PROVIDER`
5. multi-provider token → all compatible providers, documented order (host first, then id lexicographic)
6. optional requirement: absent → no edge; incompatible → diagnostic without failure
7. version ranges: `^1.2.3`, `>=2 <3`, prerelease exclusion — via `internal/semver` (no lexical sort anywhere)
8. cycle of 2, cycle of 3, self-edge → `DEPENDENCY_CYCLE` with full path each time
9. stopped provider listed as `'stopped'`, never selected
10. host provider + plugin providing same token → `AMBIGUOUS_PROVIDER` (construction-time for hosts)
11. reverse edges complete for every selected edge (feeds INV-11/15)
12. lexicographic tie-break produces identical plans across runs

### `runtime.test.ts` — proves INV-06/09/10/11/13 and note-02 contracts

1. install validates + freezes; mutation attempt throws (ADR-06)
2. duplicate install → `DUPLICATE_PLUGIN`
3. start happy path: statuses traverse `installed→preparing→active`; observers see exactly one `started` event with immutable snapshot
4. setup provides undeclared capability → `ACTIVATION_FAILED`, resources disposed (INV-01)
5. declared provide never published → `ACTIVATION_FAILED` (note 02)
6. `require` of undeclared token (JS consumer) → `INVALID_STATE` (INV-09)
7. `ctx.provide` staged invisible via `inspect()` until commit (INV-06)
8. contribution id owned by unrelated active generation → validation failure; shadowing the replaced generation allowed (note 03 step 7)
9. stop with active dependents → `ACTIVE_DEPENDENTS` with path, zero state change (INV-11)
10. stop with cascade → reverse dependency order, `cascade` list recorded, no auto-restart (INV-11)
11. start never-installed id → `INVALID_STATE`; replace uninstalled id → `INVALID_STATE` (note 02 scope rule)
12. uninstall active → `INVALID_STATE`; uninstall stopped → removed, definition gone, no other state touched
13. two runtime instances, interleaved operations, zero shared state (INV-13)
14. observer throwing → diagnostic recorded, lifecycle outcome unchanged; sync re-entry → `INVALID_STATE` (note 03)
15. provider startup while provider queue busy → consumer waits on tail, no interleave (ADR-04)
16. runtime.dispose: reverse activation order, all scopes closed, second call no-op; queued ops rejected `INVALID_STATE`

### `replacement.test.ts` — the nine transaction gates of note 06, **written first (P0)**

| # | Note-06 blocker | Also proves |
|---|---|---|
| T-R1 | setup throws after acquiring three resources → all three disposed | INV-01 |
| T-R2 | candidate replacement throws → old generation active **and usable** (a call into its capability succeeds during the failed window) | INV-07 |
| T-R3 | candidate validation fails → zero candidate capabilities/contributions visible | INV-06 |
| T-R4 | old disposal fails after commit → new generation active, `DISPOSAL_FAILED` inspectable, no restore attempt | INV-08, INV-14 |
| T-R5 | 100 replacements → resource counters at baseline | INV-12 |
| T-R6 | dependent stop without cascade → rejected, no state change | INV-11 |
| T-R7 | provider stop with cascade → dependents first, deterministic order | INV-11 |
| T-R8 | runtime disposal twice → no duplicate disposer calls, no unhandled rejection | INV-05 |
| T-R9 | provider replacement with active dependents → rejected with path, zero state change | INV-15 |

Plus: candidate commit ordering (publish → active → old disposed) asserted by event sequence; `preparing` interrupted by stop → failure, nothing published (INV-06).

### `inspection.test.ts`, `errors.test.ts`, `capability.test.ts`, `contributions.test.ts`

- blocked-plugin tree renders note 04's exact shape for its example graph; staged entries never appear (INV-06); INV-14 failure visible on the new generation.
- `MoltError` cause chains preserved through `from()`; `isMoltError` across VM boundary (node `vm` module); deterministic message format.
- token grammar accept/reject table; frozen output; structural equality across two factory copies (ADR-05).
- staged/commit lifecycle: duplicate id, post-commit staging → `INVALID_STATE`.

## 3. Property-based tests (`test/property/`, fast-check)

**Generators.** A single composite generator produces a world, not a scenario:

- `arbWorld`: 1–40 definitions; plugin ids and capability ids from the grammar; versions from a small semver pool; ranges from a pool containing always-true, always-false, and overlapping ranges; `optional` flags; `multiple` tokens; provider-count skew (0/1/2+ providers per capability); host providers for a subset of capabilities.
- `arbFailureInjection`: per-activation failure probability, injected at setup-throw, setup-reject, disposer-throw, and commit-validation points.
- `arbOperations`: random sequences of `install/start/stop/replace/uninstall/dispose` honoring precondition validity (valid operations only — invalid ones have dedicated unit tests).

**Invariants asserted after *every* operation** (the note-06 list, mechanized):

```
active plugin      → exactly one active generation                    (INV-05's dual)
visible capability → belongs to an active generation or host provider  (INV-06)
visible contribution → belongs to an active generation                 (INV-06)
disposed generation → owns zero live runtime resources                 (INV-12)
+ per-plugin op queue idle between operations; observer event log matches status log
```

**Model-based testing.** fast-check's model-based runner drives the real runtime against a trivial reference model (a map of statuses); any divergence pinpoints the exact operation. The model is intentionally dumb — Molt is not allowed to be cleverer than the model about observable state.

**Determinism.** Seeds are logged; failures replay with `--seed`. CI runs a fixed seed for stability plus one random-seed job per PR.

## 4. Stress tests (`test/stress/`)

- 1,000+ generated definitions resolved; budget: plan construction < 100 ms on CI hardware, asserted as a loose ceiling (resolver is O(V+E); a quadratic regression trips this).
- replace-100× leak zeroing with three resource kinds (event-like, timer-like, connection-like) — the user-visible statement of INV-12.
- 10k operations through one runtime with observers attached; bounded memory asserted via diagnostic ring-buffer caps (ADR-08).

## 5. Environment matrix

| Environment | How | Why |
|---|---|---|
| Node 22, Node 24 | CI matrix | engines floor + active LTS ([01 §2](./01-repository-layout.md)) |
| happy-dom | vitest environment, same unit suite | "browser-like environment" requirement of note 01; proves no Node-specific imports |
| real browser smoke | Playwright, P3, one happy-path + one replacement test | end-to-end honesty for the React/Vite adapters |
| Windows + Ubuntu + macOS | CI matrix | path/async edge behavior; a public library cannot be unix-only |

## 6. Coverage thresholds

vitest v8 provider, enforced in G3:

- `runtime-core/src`: **90% lines, 85% branches, 100% of `scope.ts` disposal engine lines** (the engine is the product; uncovered disposal branches are where leaks hide).
- **Amendment (2026-08-30, P1):** `runtime.ts` carries defense-in-depth guards for states the invariants make unreachable (queue-serialized busy checks, disappeared-binding recovery, uninstall-with-dependents). Those branches are gated per-file at **87 lines / 69 branches**, and the global branch gate is correspondingly **80%**. Everything reachable is held to the original bar; the exception is scoped to guards whose only reachable trigger would be an invariant violation elsewhere.
- `internal/async.ts`: 100% lines.
- Adapters: 85% lines; the React error-boundary paths are branch-covered regardless of threshold.
- Threshold misses fail CI; suppression requires an INV-linked comment and review approval — one suppression maximum per module.

## 7. Test-quality rules

- No test sleeps on real timers; fake timers or awaited deferreds only.
- No test may assert on private state — assertions go through public API, observers, inspection, or test-kit counters (the suite must survive refactors; note 06: "A host can inspect why a plugin is blocked without reading internal maps" — tests must not either).
- Every `@throws` code in [03](./03-core-implementation-spec.md) has ≥1 test asserting the code, not just "throws".
- The P0 replacement contract tests fail against a stub runtime on day one — a test suite that passes against nothing proves nothing.
