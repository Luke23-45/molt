# Molt — Implementation Ledger

The single live task tracker for the whole build. Every deliverable from [00–06](./README.md) appears here exactly once, grouped by phase, referenced to the document that defines it. Work proceeds top to bottom; a phase starts only when the previous phase's exit gate is checked.

## Rules for using this ledger

- Tick `[x]` only when the item meets the Definition of Done (plan README ground rule 7: implementation + tests + docs + gates). Append the PR link in parentheses.
- **No partial ticks.** An item is done or it is not; "almost" stays `[ ]`.
- Granularity: the ledger tracks *deliverables* (files, packages, gates, demos). Test-case-level detail lives in [04](./04-test-plan.md) and is not duplicated here — a test-file item is done when every case listed for it in 04 exists and passes.
- The nine transaction tests (P0-B) are individually tracked because note [06](../notes/06-validation-and-release-gates.md) makes each of them a release blocker.
- Adding a task not traceable to a plan document is forbidden; add it to the plan first, then here.

---

## P0 — Bootstrap and contract tests

### A. Repository bootstrap

- [ ] **P0-A1** Create repository at `github.com/moltjs` (org available per note [08](../notes/08-positioning-and-related-work.md) naming record); push `docs/` as the first commit; protect `main` (PRs only, linear history) — [06 §2](./06-ci-release-and-governance.md) — _open: creating a GitHub organization and repository is a browser-only action in this environment (no `gh` CLI). Everything is staged for it: governance files reference `@moltjs/core` and the `moltjs/molt` remote. Push + branch protection complete this item._
- [x] **P0-A2** pnpm workspace skeleton: root `package.json` (scripts per [02 §2](./02-tooling-and-quality-gates.md)), `pnpm-workspace.yaml`, `packageManager` pin, engines `node >=22` — [01 §2](./01-repository-layout.md) (bootstrap commit, solo — PR flow starts at P0-A1)
- [x] **P0-A3** TypeScript strategy: `tsconfig.base.json`, `tsconfig.packages.json`, `tsconfig.tests.json` with the exact options of [01 §3](./01-repository-layout.md) (DOM excluded from `lib` everywhere in core) (bootstrap commit, solo)
- [x] **P0-A4** Lint/format: flat `eslint.config.js` (typescript-eslint, type-checked, `no-floating-promises`, `any`/assertion bans) + `prettier.config.js` — [02 §1](./02-tooling-and-quality-gates.md) (bootstrap commit, solo)
- [x] **P0-A5** Test rig: root `vitest.config.ts` projects `unit` / `property` / `stress`; coverage provider + thresholds wired; rig smoke test green in `packages/runtime-core/test/toolchain.test.ts` — [04 §1](./04-test-plan.md), [04 §6](./04-test-plan.md) (bootstrap commit, solo; the package skeleton is the rig's verification target and its P1 items stay open)
- [x] **P0-A6** Architecture hygiene: `.cruiser.json` (core-purity rules of gate G6), `knip.json`, `api-extractor.json` base — [02 §3](./02-tooling-and-quality-gates.md) (bootstrap commit, solo; `pnpm check:arch` green, 0 violations)
- [x] **P0-A7** Governance files: `LICENSE` (MIT), `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` (Covenant v2.1, fetched verbatim from contributor-covenant.org), `SECURITY.md`, `CODEOWNERS`, PR template, issue templates (bug / **lifecycle-semantics** / feature) — [06 §3](./06-ci-release-and-governance.md) (bootstrap commit, solo)
- [x] **P0-A8** CI skeleton: `.github/workflows/verify.yml` with the full stage/matrix table of [06 §1](./06-ci-release-and-governance.md) — gates G1–G9 running from day one (bootstrap commit, solo; stages whose enabling ledger items are open run `continue-on-error` with in-file markers naming P1-E7/E8/E10/E11)
- [x] **P0-A9** Pin all tool versions; record the lock table in this file (append a "Tool versions" section below when done) (bootstrap commit, solo; TypeScript pinned to the 5.x line — typescript-eslint's peer range requires `<6.1.0` and TS 7 is not yet compatible; deferred pins: fast-check/tsdown/api-extractor at P1, mitata at P3, changesets before P5)

### B. Replacement contract tests — written first, against nothing (they must fail)

- [x] **P0-B1** `packages/runtime-core/test/replacement.test.ts` scaffolded with fake resources and counters; every test asserts its `MoltError` code, not just "throws" — [03 §7](./03-core-implementation-spec.md), [04 §2](./04-test-plan.md) (red by design; typed against the P0 contract declaration `src/index.d.ts`, which is types-only and is deleted at P1-D11)
- [x] **P0-B2** **T-R1** setup throws after acquiring three resources → all three disposed (INV-01) (red by design)
- [x] **P0-B3** **T-R2** candidate replacement throws → old generation active *and usable* during the failed window (INV-07) (red by design)
- [x] **P0-B4** **T-R3** candidate validation fails → zero candidate capabilities/contributions visible (INV-06) (red by design; forced the `contributions()` amendment)
- [x] **P0-B5** **T-R4** old disposal fails after commit → new generation active, `DISPOSAL_FAILED` inspectable, no restore (INV-08, INV-14) (red by design; forced the disposal-await amendment)
- [x] **P0-B6** **T-R5** 100 replacements → resource counters at baseline (INV-12) (red by design)
- [x] **P0-B7** **T-R6** dependent stop without cascade → rejected, zero state change (INV-11) (red by design)
- [x] **P0-B8** **T-R7** provider stop with cascade → dependents first, deterministic order (INV-11) (red by design)
- [x] **P0-B9** **T-R8** runtime disposal twice → no duplicate disposer calls, no unhandled rejection (INV-05) (red by design)
- [x] **P0-B10** **T-R9** provider replacement with active dependents → rejected with dependent path, zero state change (INV-15) (red by design)
- [x] **P0-B11** Commit-ordering test (publish → active → old disposed, by event sequence) + interrupted-`preparing` test (INV-06) (red by design) — [04 §2 replacement extras](./04-test-plan.md)

**Exit gate P0:** T-R1…T-R9 exist, fail against a stub runtime, and encode INV-01/06/07/11 — note [07 Phase 0](../notes/07-implementation-roadmap.md). **Met** (2026-08-30): 11 contract tests exist and fail at import — the runtime does not exist yet; typecheck, lint, and architecture gates are green because the tests are typed against the contract declaration.

## P1 — `runtime-core` (`@molt/runtime`)

### C. Design-note amendments (land in the same PR as the code that makes them true — [00 §9](./00-system-architecture.md))

- [x] **P1-C1** Note 02: add `INVALID_STATE` to `RuntimeErrorCode`
- [x] **P1-C2** Note 02: record ADR-05 (resolution keyed by token `id`, not identity)
- [x] **P1-C3** Note 04: record deterministic multi-provider ordering (host first, then id lexicographic)
- [x] **P1-C4** Note 03: record the busy policy (queue-and-wait, ADR-10)

### D. Core modules — in dependency order ([00 §1](./00-system-architecture.md), [01 §5](./01-repository-layout.md))

- [x] **P1-D1** `internal/async.ts` — deferreds, `AsyncMutex`, `OperationQueue`, idempotent wrapper, `BoundedLog` (ADR-08, ADR-10)
- [x] **P1-D2** `internal/semver.ts` — the only import of `semver` (ADR-02)
- [x] **P1-D3** `errors.ts` — `MoltError`, 11 codes, cause chains, `isMoltError` brand check, `DisposalReport` ([03 §3](./03-core-implementation-spec.md))
- [x] **P1-D4** `capability.ts` — token factory, policy field, id/version grammar, frozen output (ADR-05) ([03 §1](./03-core-implementation-spec.md))
- [x] **P1-D5** `definition.ts` — types + 8-step validation + deep-shallow freeze (ADR-06) ([03 §2](./03-core-implementation-spec.md))
- [x] **P1-D6** `scope.ts` — `Scope`, disposal engine (abort → LIFO → continue-on-error → report), `Symbol.asyncDispose` (ADR-09) ([03 §4](./03-core-implementation-spec.md))
- [x] **P1-D7** `contributions.ts` — staged/commit snapshots, shadowing rules ([03 §6](./03-core-implementation-spec.md))
- [x] **P1-D8** `resolver.ts` — selection, ranges, cycles with full path, deterministic order, reverse edges, `BlockedDiagnostic` ([03 §5](./03-core-implementation-spec.md))
- [x] **P1-D9** `inspection.ts` — frozen snapshots, blocked-plugin tree renderer ([03 §8](./03-core-implementation-spec.md))
- [x] **P1-D10** `runtime.ts` — lifecycle engine: transition table, activation (9 steps), replacement protocol, stop/cascade, uninstall, runtime disposal, observer bus ([03 §7](./03-core-implementation-spec.md))
- [x] **P1-D11** `index.ts` — exact public surface of [03 §10](./03-core-implementation-spec.md); JSDoc + `@throws` on every export (ground rule 2); replaces and deletes `src/index.d.ts` (the P0 contract declaration)

### E. Core test files — every case enumerated in [04 §2](./04-test-plan.md)

- [x] **P1-E1** `internal/async.test.ts` — mutex/queue/wrapper/log in isolation
- [x] **P1-E2** `scope.test.ts` — 13 cases (INV-01/02/03/04/05/12)
- [x] **P1-E3** `resolver.test.ts` — 12 case groups (INV-10; note-04 provider rules exhaustively)
- [x] **P1-E4** `capability.test.ts`, `definition.test.ts`, `errors.test.ts`, `contributions.test.ts`, `inspection.test.ts`
- [x] **P1-E5** `runtime.test.ts` — 16 cases (INV-06/09/10/11/13; ADR-04 wait behavior; ADR-06 freeze)
- [x] **P1-E6** P0-B tests turn **green** (the contract tests pass against the real engine)
- [ ] **P1-E7** Property suite (`test/property/`): `arbWorld` / `arbFailureInjection` / `arbOperations` generators, reference model, INV assertions after every op, seeded determinism — [04 §3](./04-test-plan.md)
- [ ] **P1-E8** Stress suite: 1,000-definition resolution budget, three-resource-kind replace-100×, 10k-op bounded memory — [04 §4](./04-test-plan.md)
- [ ] **P1-E9** Environment matrix green: node 22/24 × happy-dom, windows/ubuntu/macos — [04 §5](./04-test-plan.md) — _local node 24 verified; the matrix itself runs in CI once the remote repository exists (P0-A1), plus a happy-dom unit run_
- [ ] **P1-E10** Packaging: tsdown dual build + dts; package manifest per [01 §4](./01-repository-layout.md); `publint` + `attw` clean; tarball clean-install test — gates G7/G8 (ADR-07)
- [ ] **P1-E11** API review file generated and human-reviewed (`*.api.md`) — gate G9
- [ ] **P1-E12** Root `README.md` first version: thesis, guarantees + limits, non-goals, "why not Effect / `using` / Cordis" on the first screen (note [08](../notes/08-positioning-and-related-work.md) obligation)

**Exit gate P1:** all unit, transaction, and property tests pass; gates G1–G9 green — note [07 Phase 1](../notes/07-implementation-roadmap.md).

## P2 — Test kit and example hosts

- [ ] **P2-1** `@molt/test`: `fakeResources` (counter factories, cue-based `failing()`, `expectNoLeaks`), `expectGenerationDisposed`, `pluginHarness` — [05 §1](./05-adapter-specs.md)
- [ ] **P2-2** `examples/command-host` — unrelated host #1; replacement + leak tests pass in it — [07 Phase 2](../notes/07-implementation-roadmap.md)
- [ ] **P2-3** `examples/worker-host` — unrelated host #2; same suite, no shared application code
- [ ] **P2-4** StrykerJS mutation-testing experiment on `scope.ts` + `runtime.ts` (recommended, not a gate) — [02 §5](./02-tooling-and-quality-gates.md)

**Exit gate P2:** replacement and leak tests run green in both examples.

## P3 — Adapters and comparison demo (one adapter at a time — note [07](../notes/07-implementation-roadmap.md))

- [ ] **P3-1** `@molt/events` — typed maps, sync/async modes, error isolation, ordering, disposed-mid-delivery; scope-acquired subscriptions proven with kit counters — [05 §2](./05-adapter-specs.md)
- [ ] **P3-2** `@molt/react` — committed-only snapshots via `useSyncExternalStore`, per-contribution error boundaries, generation-scoped unmount, stale-callback guard — [05 §3](./05-adapter-specs.md)
- [ ] **P3-3** `@molt/vite` — HMR event mapping table, failures keep old generation, serialized updates, provider-change revalidation — [05 §4](./05-adapter-specs.md)
- [ ] **P3-4** `@molt/sqlite` — checksummed owned migrations, no-rollback-on-stop by construction, explicit host-only destructive API — [05 §5](./05-adapter-specs.md)
- [ ] **P3-5** Adapter gate for each of P3-1…P3-4: forced failure → core invariants hold + `expectNoLeaks()` — [05 §6](./05-adapter-specs.md)
- [ ] **P3-6** `demo/comparison` harness: naive registry + pinned Cordis + Molt runners; failing-then-succeeding scenario; `RESULTS.md` + JSON regenerated by `pnpm bench` — [02 §4](./02-tooling-and-quality-gates.md)
- [ ] **P3-7** Browser smoke via Playwright: one happy path + one replacement path — [04 §5](./04-test-plan.md)
- [ ] **P3-8** Benchmark artifact job on the release branch (gate G10) — [06 §1](./06-ci-release-and-governance.md)

**Exit gate P3:** every adapter's failures preserve core invariants.

## P4 — Sky integration (note [07 Phase 4](../notes/07-implementation-roadmap.md))

- [ ] **P4-1** Thin bridge from Sky plugins to Molt definitions
- [ ] **P4-2** Sky UI registration behind `@molt/react`
- [ ] **P4-3** Sky database access behind the `database.connection` capability
- [ ] **P4-4** Remove the current global plugin registry from the library path
- [ ] **P4-5** Compatibility layer marked transitional in code and docs; Sky manifests/policy stay in Sky

**Exit gate P4:** Sky runs on Molt.

## P5 — Publication review (note [07 Phase 5](../notes/07-implementation-roadmap.md), [06 §4](./06-ci-release-and-governance.md))

- [ ] **P5-1** Claim npm org `@molt`; configure trusted publishing/provenance — [06 §1](./06-ci-release-and-governance.md)
- [ ] **P5-2** `release.yml` dry run: changesets version PR → publish to a dry registry/tag — full pipeline exercised before a real release
- [ ] **P5-3** Publish-evidence checklist, item by item: core published w/ G1–G9 green; two hosts + Sky; `RESULTS.md` regenerated; limitations documented; zero invariant failures (or documented waiver); "why a simple registry is insufficient" demo row + README sample — [06 §4](./06-ci-release-and-governance.md)
- [ ] **P5-4** Positioning review against the thesis: host-agnostic proven? failed replacement materially better than Cordis (per demo)? guarantees narrow and proven? unrelated hosts benefit? — the five questions of note [07 Phase 5](../notes/07-implementation-roadmap.md), answered in writing
- [ ] **P5-5** Optional: TypeDoc docs site on tags — [06 §5](./06-ci-release-and-governance.md)
- [ ] **P5-6** Optional: Deno smoke test (same shape as the Bun smoke, ADR-13)

**Exit gate P5:** publish, or consciously keep internal — note [06](../notes/06-validation-and-release-gates.md): that is a valid result, not a failure.

---

## Tool versions

_(P0-A9: fill this table at bootstrap; every entry pinned in the root `package.json`.)_

| Tool | Version | Pinned on |
|---|---|---|
| node | 24.4.1 local (CI matrix: 22, 24) | 2026-08-30 |
| pnpm | 11.24.0 (`packageManager` pin) | 2026-08-30 |
| typescript | 5.9.3 — 5.x line, not 7: typescript-eslint peer requires `<6.1.0` | 2026-08-30 |
| vitest | 4.1.11 | 2026-08-30 |
| @vitest/coverage-v8 | 4.1.11 | 2026-08-30 |
| eslint | 10.9.1 | 2026-08-30 |
| typescript-eslint | 8.68.0 | 2026-08-30 |
| eslint-plugin-simple-import-sort | 14.0.0 | 2026-08-30 |
| prettier | 3.9.6 | 2026-08-30 |
| knip | 6.33.0 | 2026-08-30 |
| dependency-cruiser | 18.2.0 | 2026-08-30 |
| publint | 0.3.24 | 2026-08-30 |
| @arethetypeswrong/cli | 0.18.5 | 2026-08-30 |
| @types/node | 24.13.3 (matches the 22/24 CI matrix) | 2026-08-30 |
| semver | P1-D2 (enters with `internal/semver.ts`) | — |
| fast-check | P1-E7 | — |
| tsdown | P1-E10 | — |
| @microsoft/api-extractor | P1-E11 | — |
| mitata | P3-6 | — |
| @changesets/cli | before P5-1 | — |
| bun (smoke only) | latest via `oven-sh/setup-bun@v2` in CI | — |

## Progress log

| Date | Phase | Event |
|---|---|---|
| 2026-08-30 | — | Ledger created; design notes and implementation plan complete; runtime decision recorded (ADR-13: Node ≥22 target, Bun smoke-verified). |
| 2026-08-30 | P0 | Bootstrap P0-A2…A9 complete and verified: `pnpm verify` green (typecheck + type-checked lint + knip), 3 rig smoke tests green, `pnpm test --coverage` green (thresholds wired; vacuous pass on empty `src/`, strict from P1), `pnpm check:arch` green (0 violations), all JSON/YAML validated. Deviations, all mirrored into the plan in the same change: Vitest 4 removed `vitest.workspace.ts` → projects live in the root `vitest.config.ts` (01/02/04 amended); TypeScript pinned to 5.9.3 because typescript-eslint's peer range requires `<6.1.0`; the runtime-core package skeleton (manifest, tsconfig, vitest config, smoke test) was created early as the rig's verification target — its P1 items remain open; `build`/`api-extract` scripts enter with tsdown/api-extractor at P1-E10/E11; CI stages awaiting their enabling items run `continue-on-error` with in-file markers. |
| 2026-08-30 | P0 | P0-A1 open: GitHub organization `moltjs`, repository creation, first push, and branch protection require the owner's browser (no `gh` CLI in this environment). Local repository is fully staged for that push. |
| 2026-08-30 | P1 | P1-C and P1-D complete: all 11 core modules implemented in dependency order; the P0 contract declaration (`src/index.d.ts`) deleted at P1-D11 as planned. P1-E1–E6 done: 137 unit tests green including all 11 replacement-contract gates (T-R1…T-R9 + ordering) against the real engine; TSC/ESLINT/knip/dependency-cruiser green; coverage enforced at the amended thresholds (runtime.ts defense-in-depth exception documented in plan 04 §6). Notable engine decisions made during test-driven development: dependency edges are recorded at commit from the resolution plan (plugins that never call require() still create dependents); stopping a preparing plugin aborts its scope signal synchronously at call time; multi-provider tokens aggregate per-provider collections; observer re-entry is rejected synchronously at call time; the note-02 `disposing` status is used during stop teardown. P1-E7 (property), E8 (stress), E10 (packaging), E11 (API review), E12 (README) remain open. |
| 2026-08-30 | P0 | P0-B complete: 11 replacement-contract tests written before any runtime exists; they fail at import (designed red — plan 04 §7) while typecheck, lint, and architecture gates stay green, because the tests are typed against `src/index.d.ts`, a types-only transcription of plan 03 (deleted at P1-D11). Two spec gaps surfaced exactly as the Phase 0 stop condition intends, and were amended into the plan in the same change: (1) `Runtime.contributions(): ContributionSnapshot` gives hosts a committed-snapshot read side, without which T-R3's INV-06 visibility claim is unexpressible; (2) the replacement protocol resolves only after the old-scope disposal attempt completes, making INV-14's diagnostic deterministically inspectable (T-R4) and guaranteeing no floating disposer rejection (T-R8). |
