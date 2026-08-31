# 02 — Tooling and Quality Gates

Tool choices are recorded with the alternative that lost, because a public library's toolchain is a promise: every choice below is boring, maintained, and replaceable behind a script. Versions are pinned at P0 kickoff and recorded in the root `package.json`; this document fixes _choices_, not version numbers that will drift.

## 1. Toolchain

| Concern             | Choice                                                                                     | Lost alternative                 | Rationale                                                                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------ | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace           | pnpm                                                                                       | yarn (Cordis uses yarn + yakumo) | strict layout, `workspace:*`, fastest CI installs; Effect's choice                                                                                                                                    |
| Build               | **tsdown** — dual ESM/CJS + `.d.ts`, unminified                                            | tshy, unbuild, raw `tsc`         | one config for dual output + dts; ships built-in packaging lint (publint + attw integration per [tsdown docs](https://tsdown.dev/options/lint)); unminified because consumers ship their own bundlers |
| Typecheck           | `tsc --noEmit` per package + root composite                                                | swc-based checkers               | the compiler is the contract; `declaration: true` catches public-type rot                                                                                                                             |
| Tests               | **vitest** (projects in the root `vitest.config.ts` — Vitest 4 removed the workspace file) | jest                             | fastest TS-native runner; workspace + environments support                                                                                                                                            |
| Property tests      | **fast-check**                                                                             | bespoke generators               | mature JS property framework; model-based testing support needed for the invariant suite ([04 §4](./04-test-plan.md))                                                                                 |
| Type-level tests    | **tstyche** (P1, focused)                                                                  | expect-type only                 | validates the capability/requirement generic UX, not just runtime behavior; Effect's choice                                                                                                           |
| Lint                | **typescript-eslint**, type-checked config                                                 | oxlint/dprint (Effect), Biome    | type-aware rules (`no-floating-promises`, `no-misused-promises`) are load-bearing for an async disposal engine; oxlint speed can be layered in later if needed                                        |
| Format              | **Prettier**                                                                               | dprint                           | zero-config consistency; avoids formatter debates in public contributions                                                                                                                             |
| Unused-code hygiene | **Knip**                                                                                   | —                                | catches dead exports in a library where the public surface is the product ([comparison](https://www.pkgpulse.com/guides/publint-vs-arethetypeswrong-vs-knip-2026))                                    |
| Architecture rules  | **dependency-cruiser**                                                                     | bespoke grep                     | machine-checked import rules: core→adapters forbidden, `internal/` unexportable, DOM forbidden ([gate G6](#3-the-gates))                                                                              |
| Packaging lint      | **publint** + **arethetypeswrong (attw)**                                                  | manual checks                    | the SOTA pair for `exports` correctness and type resolution across modes; run in CI and `prepublishOnly`                                                                                              |
| API review          | **@microsoft/api-extractor**                                                               | none (review by eye)             | generates an `*.api.md` review file; CI fails on any public-surface change not reflected in the reviewed file — this is what keeps "no accidental API" true over years                                |
| Docs                | **TypeDoc** (P5 for the docs site)                                                         | hand-written API docs            | generated from the same JSDoc required by ground rule 2                                                                                                                                               |
| Coverage            | vitest v8 provider, thresholds in [04](./04-test-plan.md)                                  | istanbul                         | native, fast, good enough for a source-shipped library                                                                                                                                                |
| Benchmarks          | **mitata**                                                                                 | tinybench                        | used by the comparison demo harness ([02 §4](#4-benchmark-and-demo-harness))                                                                                                                          |
| Release             | **changesets** + npm provenance                                                            | semantic-release                 | works per-package in monorepos; human-reviewed changelogs; Effect's choice                                                                                                                            |

## 2. Root scripts (single entry points)

```jsonc
{
  "scripts": {
    "verify": "pnpm -r typecheck && pnpm -r lint && pnpm knip",
    "build": "pnpm -r build",
    "test": "vitest run",
    "test:property": "vitest run --project property",
    "test:stress": "vitest run --project stress",
    "check:pkg": "pnpm -r exec publint && pnpm -r exec attw --pack .",
    "check:arch": "depcruise packages --config .cruiser.json",
    "check:api": "pnpm -r api-extract",
    "bench": "pnpm --filter ./demo/comparison bench",
    "changeset": "changeset",
    "release:dry-run": "node scripts/release-dry-run.mjs",
  },
}
```

`pnpm verify` must pass on a fresh clone with two commands (`pnpm install && pnpm verify`). Anything a contributor cannot run in two commands is a bug in the repo.

## 3. The gates

Gates are numbered; CI ([06](./06-ci-release-and-governance.md)) and the DoD reference them by ID. A gate is a command with a defined pass condition — no gate depends on human memory.

| ID  | Gate              | Command                                                                                                               | Pass condition                                                                                                                                                           |
| --- | ----------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| G1  | Typecheck         | `tsc --noEmit` (all packages)                                                                                         | zero errors under the [01 §3](./01-repository-layout.md) strict options                                                                                                  |
| G2  | Lint + format     | `eslint . && prettier --check .`                                                                                      | zero violations, including `no-floating-promises` and the `any`/assertion bans                                                                                           |
| G3  | Unit tests        | `vitest run` (unit project)                                                                                           | 100% pass, coverage thresholds met ([04 §6](./04-test-plan.md))                                                                                                          |
| G4  | Property + stress | `vitest run --project property --project stress`                                                                      | 100% pass; INV-01…INV-15 all exercised; replace-100× leak test at baseline                                                                                               |
| G5  | Dead-code hygiene | `knip`                                                                                                                | zero unused exports in packages (exports are the product; dead ones are lies)                                                                                            |
| G6  | Core purity       | `depcruise` + bundle import scan                                                                                      | `runtime-core` imports no browser, UI, database, or adapter module (notes [01](../notes/01-thesis-and-boundaries.md), [06](../notes/06-validation-and-release-gates.md)) |
| G7  | Packaging lint    | `publint` + `attw --pack` per package                                                                                 | zero errors across bundler/node10/node16 resolution                                                                                                                      |
| G8  | Tarball install   | `pnpm pack` + clean install into a scratch project; built ESM entry imported under Bun with a minimal lifecycle smoke | the published-tarball test of note 06 passes; "works under Bun" is proven, not assumed (ADR-13)                                                                          |
| G9  | API review        | `api-extractor` diff                                                                                                  | public surface changes are present and human-reviewed in the `*.api.md` file                                                                                             |
| G10 | Benchmarks        | `pnpm bench`                                                                                                          | comparison demo runs reproducibly; results recorded as artifacts (no regression threshold until P5 baseline)                                                             |

G6 detail — the dependency-cruiser ruleset enforces, mechanically: `runtime-core` may not import `react`, `vite`, `sql.js`, `indexeddb`, any `@molt/*` adapter, or any `dom`-typed module; `internal/` may not be imported across package boundaries; adapters may import only `@molt/runtime` plus their host library. The bundle scan additionally greps `dist/index.js` for the string fingerprints of banned modules as a belt-and-suspenders check on top of source rules.

## 4. Benchmark and demo harness

`demo/comparison` is the reproducible evidence harness required by notes [06](../notes/06-validation-and-release-gates.md) and [08](../notes/08-positioning-and-related-work.md):

- **Runners:** naive registry (register/activate, no ownership), current Cordis (version pinned and printed in the output), Molt.
- **Scenario:** a plugin acquires listeners, timers, and UI contributions; then receives a failing replacement, then a succeeding one; repeated 100×.
- **Reported per runner:** old-generation liveness during the failed window (did it keep serving?), leaked-resource count after 100 replacements, and the blocked-plugin diagnostic shown to the user.
- **Output:** a markdown table written to `demo/comparison/RESULTS.md` plus raw JSON — committed artifacts, regenerable by `pnpm bench`.

The demo is also the README's headline evidence (note [08](../notes/08-positioning-and-related-work.md) obligations): the README links to `RESULTS.md`, and `RESULTS.md` is regenerated in CI on the release branch so the published numbers can never go stale silently.

## 5. What is deliberately not adopted

- **Monorepo meta-frameworks** (nx, turborepo) — at six small packages, pnpm filters and a root script are simpler and auditable; revisit only if task graphs become non-obvious.
- **semantic-release** — automates decisions a reviewed-changelog library wants humans to make; changesets keeps review in the loop.
- **Bundle-size budget tooling** — core is a runtime, not a UI dep; benchmark honesty (G10) matters more than byte counts until P5 evidence says otherwise.
- **Mutation testing (StrykerJS)** — recommended as an experiment in P2, not a gate; the invariant suite already ties tests to behavior more directly than mutation scores would.
