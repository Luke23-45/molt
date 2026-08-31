---
name: molt-testing
description: How tests are written in the Molt repository — invariant-named tests (INV-xx), the nine transaction gates T-R1..T-R9 that are release blockers, fast-check property-based testing with reference models, coverage thresholds, and the forbidden test patterns. Use when writing, changing, or reviewing any test file, or when a change might affect lifecycle behavior.
license: MIT
metadata:
  author: moltjs
  version: '1.0'
---

# Molt testing rules

Full source: `docs/implement_plan/04-test-plan.md`. The suite is designed around failure because failure behavior is the product (note 06).

## Naming and structure

- Every test name cites what it proves: `it('INV-07: failed candidate replacement leaves the old generation serving', …)`. A test without an INV or spec-section reference is rejected in review.
- Test files mirror source files one-to-one (`scope.test.ts`, `resolver.test.ts`, `runtime.test.ts`, `inspection.test.ts`, `errors.test.ts`, `capability.test.ts`, `contributions.test.ts`, plus `internal/async.test.ts`). `replacement.test.ts` holds the transaction gates.
- Vitest projects defined in the root `vitest.config.ts` (Vitest 4 removed `vitest.workspace.ts`): `unit` (node + happy-dom), `property` (fast-check), `stress`. Run with `pnpm test`, `pnpm test:property`, `pnpm test:stress`.

## The transaction gates — release blockers (note 06)

Written in P0 **before** the implementation existed; they must fail against a stub runtime and stay green forever:

| ID   | Assertion                                                                                                      |
| ---- | -------------------------------------------------------------------------------------------------------------- |
| T-R1 | setup throws after acquiring three resources → all three disposed (INV-01)                                     |
| T-R2 | candidate replacement throws → old generation active **and usable** during the failed window (INV-07)          |
| T-R3 | candidate validation fails → zero candidate capabilities/contributions visible (INV-06)                        |
| T-R4 | old disposal fails after commit → new generation active, `DISPOSAL_FAILED` inspectable, no restore (INV-08/14) |
| T-R5 | 100 replacements → resource counters at baseline (INV-12)                                                      |
| T-R6 | dependent stop without cascade → rejected, zero state change (INV-11)                                          |
| T-R7 | provider stop with cascade → dependents first, deterministic order (INV-11)                                    |
| T-R8 | runtime disposal twice → no duplicate disposer calls, no unhandled rejection (INV-05)                          |
| T-R9 | provider replacement with active dependents → rejected with path, zero state change (INV-15)                   |

Every `@throws` code documented in `docs/implement_plan/03` has ≥1 test asserting the **code**, not just "throws".

## Property-based testing (fast-check)

- One composite `arbWorld` generator (definitions, versions, ranges, optionals, multi-provider tokens, host providers), `arbFailureInjection` (setup-throw, setup-reject, disposer-throw, commit-validation points), `arbOperations` (valid op sequences of install/start/stop/replace/uninstall/dispose).
- The note-06 invariants are asserted after **every** operation: active plugin ⇔ exactly one active generation; visible capability/contribution ⇔ active generation or host provider; disposed generation ⇔ zero live resources.
- Model-based: drive the real runtime against a trivial reference model; divergence pinpoints the operation. The model is intentionally dumb — Molt may not be cleverer than the model about observable state.
- Seeds are logged; CI runs a fixed seed plus a random-seed job. Failures must replay with the logged seed.

## Forbidden test patterns

- No real timers, no `sleep`, no waiting on clocks — fake timers or awaited deferreds only.
- No assertions on private state. Assertions go through public API, observers, `inspect()`, or `@molt/test` counters — the suite must survive refactors, and note 06 forbids hosts (including test hosts) from reading internal maps.
- No test that passes against a stub/empty implementation of the unit under test — if deleting the feature keeps the test green, the test is testing nothing.
- No test-only backdoors added to core (counters live in the fake resources, not in production code).
- No coverage-threshold suppression without an INV-linked comment and review approval; at most one suppression per module.

## Thresholds and environments

Coverage (gate G3): `runtime-core/src` 90% lines / 80% branches, with the documented per-file exception for `runtime.ts` defense-in-depth guards; **100% lines of the `scope.ts` disposal engine** and of `internal/async.ts`; adapters 85% lines with React error-boundary paths branch-covered. The 80% branch threshold is the P1 amendment recorded in plan 04 §6 and mirrored in both Vitest configs. Environments (gate G4/CI matrix): node 22, node 24 × ubuntu/windows/macos, unit suite also under happy-dom; browser smoke via Playwright lands in P3.
