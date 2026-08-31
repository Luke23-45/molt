# Molt — Implementation Plan

This directory is the executable engineering plan for the design in [`../notes/`](../notes/README.md). The notes say **what** Molt is and **why** each guarantee exists; this plan says **exactly what to build, in what order, and how completion is proven**. Nothing here introduces a behavior that the notes do not authorize; where the plan must refine a note, the refinement is recorded as an ADR in [00](./00-system-architecture.md) and mirrored into the notes in the same change.

This is a public open-source library from its first commit. The quality bar below is not aspirational — every rule is enforced by a gate in [02](./02-tooling-and-quality-gates.md) and [06](./06-ci-release-and-governance.md).

## Document index

| Document                                                                | Contents                                                                                                                                                                                                          |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [00-system-architecture](./00-system-architecture.md)                   | Component map, canonical invariant registry, runtime state model, core algorithms (resolver, activation, replacement, cascade, disposal), concurrency model, error model, ADRs, required amendments to the notes. |
| [01-repository-layout](./01-repository-layout.md)                       | Monorepo tree, workspace configuration, TypeScript strategy, the file-by-file contract for `runtime-core`, coding standards.                                                                                      |
| [02-tooling-and-quality-gates](./02-tooling-and-quality-gates.md)       | Toolchain choices with rationale (build, test, lint, property tests, API review, packaging checks) and the numbered quality gates wired into CI.                                                                  |
| [03-core-implementation-spec](./03-core-implementation-spec.md)         | Per-module specification of `runtime-core`: public API, internal representation, algorithm pseudocode, and exhaustive edge-case lists.                                                                            |
| [04-test-plan](./04-test-plan.md)                                       | Complete test inventory mapped to the release gates, property-based test design, stress and leak tests, environment matrix, coverage thresholds.                                                                  |
| [05-adapter-specs](./05-adapter-specs.md)                               | Specifications for the test kit and the three adapters (events, React, Vite HMR), each with its failure-behavior requirements.                                                                             |
| [06-ci-release-and-governance](./06-ci-release-and-governance.md)       | CI pipelines, release flow (changesets + provenance), branch protection, governance files, and the publish-day checklist.                                                                                         |
| [07-readiness-and-remaining-work](./07-readiness-and-remaining-work.md) | Evidence-based review of the implemented core, release blockers, contract reconciliation, and the ordered plan for P1 revalidation through P5.                                                                    |
| [ledger](./ledger.md)                                                   | **The live task tracker** — every deliverable as a checkable item, grouped by phase, referenced to its defining document. Work is tracked here and only here.                                                     |
| [../notes/09-packages-and-distribution.md](../notes/09-packages-and-distribution.md) | Published set, TanStack/Effect distribution pattern, install matrix, and the 14-step checklist for adding a new adapter. |

## Ground rules

These are hard rules. A pull request that violates any of them is rejected regardless of what it adds.

1. **No stubs.** No `TODO` in place of behavior, no empty branches, no "not implemented yet" paths in shipped code. A capability that is not built is not exported.
2. **Documented public API.** Every exported symbol carries JSDoc that states its contract and its `@throws` error codes.
3. **Every invariant is tested.** The canonical invariant registry (INV-01…INV-15 in [00](./00-system-architecture.md)) is the index into the test suite; each invariant has at least one automated test that fails if the invariant breaks ([04](./04-test-plan.md)).
4. **Strictest TypeScript.** The compiler options in [01](./01-repository-layout.md) are non-negotiable; `any` and non-null assertions are forbidden by lint.
5. **Dependency discipline.** `runtime-core` has exactly one runtime dependency (`semver`, per note [04](../notes/04-capabilities-and-dependencies.md)). Host globals (`AbortController`, `EventTarget`) are assumed present.
6. **A phase is done when its exit gate passes**, as defined in note [07](../notes/07-implementation-roadmap.md) and operationalized in [06](./06-ci-release-and-governance.md).
7. **Definition of Done for any task:** implementation + tests proving it + documentation + all gates green. A task missing any of the four is not done.

## Phase overview

| Phase | Scope (from note 07)                                       | Exit gate                                                                       |
| ----- | ---------------------------------------------------------- | ------------------------------------------------------------------------------- |
| P0    | Replacement-contract tests written before any runtime code | The four contract tests exist, fail, and encode INV-01/07/06/11                 |
| P1    | `runtime-core` only                                        | All unit, transaction, and property tests green; gates G1–G9 green              |
| P2    | Test kit (`@molt/test`) + two unrelated example hosts      | Replacement and leak tests pass in both examples                                |
| P3    | Adapters one at a time: events → React → Vite     | Each adapter's failures preserve core invariants                                |
| P4    | Out of scope for this repository                           | No Molt-repository implementation task; downstream Sky work is separate         |
| P5    | Publication review against the thesis                      | Every item in the publish-evidence list exists; else the library stays internal |
