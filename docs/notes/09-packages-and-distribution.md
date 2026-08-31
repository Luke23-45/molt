# 09 — Packages and Distribution

How Molt is published as scoped `@molt/*` packages, how it mirrors the TanStack/Effect pattern, and how to add a new framework adapter without confusion. This note is the authority for `what is publishable` — `docs/implement_plan/01-repository-layout.md` and `05-adapter-specs.md` implement it.

## 1. Current publishable set

After the SQLite hard-delete (`packages/sqlite` removed, `pnpm-lock.yaml` importer deleted), the monorepo publishes **5** packages, all `0.0.0` until the first Changesets version PR:

| Package | Directory | Published? | `peerDependencies` |
|---|---|---|---|
| `@molt/runtime` | `packages/runtime-core` | Yes — core | `semver ^7.8.5` is the only `dependencies` (`packages/runtime-core/package.json:49`) |
| `@molt/test` | `packages/test` | Yes — support, ships with core | `peer: @molt/runtime workspace:*` |
| `@molt/events` | `packages/events` | Yes — adapter (demo of scoped subscriptions) | `peer: @molt/runtime workspace:*` |
| `@molt/react` | `packages/react` | Yes — adapter | `peer: @molt/runtime workspace:*, react >=18` (`packages/react/package.json:49`) |
| `@molt/vite` | `packages/vite` | Yes — adapter (headline HMR demo) | `peer: @molt/runtime workspace:*` |

Verifier: `pnpm-workspace.yaml:1` `packages: ['packages/*','examples/*','demo/*']` discovers the 5 dirs; `.changeset/calm-crabs-molt.md:2` lists the same 5 `minor` entries; `.github/workflows/release.yml:90` asserts `test "$(find "$pack_dir" -name '*.tgz' | wc -l)" -eq 5`; `docs/release-readiness.md:36` `five package tarballs`.

`examples/command-host`, `examples/worker-host`, `demo/comparison`, `demo/browser-smoke` are `private` workspaces — never published (` .changeset/config.json:10` `ignore: [...]`).

## 2. How top libraries do the same

Search-verified on 2026-08-31:

* **TanStack Query** (`github.com/TanStack/query`, 50k stars): `packages/query-core` — `name: @tanstack/query-core`, `sideEffects: false`, no framework deps (`packages/query-core/package.json:3`); `packages/react-query` — `dependencies: {"@tanstack/query-core":"workspace:*"}`, `peerDependencies: {"react":"^18 || ^19"}` (`packages/react-query/package.json: dependencies/peerDependencies` fetched via `webfetch`). Install is `npm i @tanstack/react-query` alone (core comes as dependency) for React, but `npm i @tanstack/lit-query @tanstack/query-core lit` for Lit where core is `peer` (`tanstack.com/query/latest/docs/framework/lit/installation: @tanstack/query-core is a peer dependency ... install explicitly`). Vue/Solid/Svelte adapters follow the same `workspace:*` + `peer framework` shape. Core is framework-agnostic, adapters are thin (`@tanstack/react-query` 84 lines package.json, `tsdown` build).
* **Effect** (`github.com/Effect-TS/effect`, 15k stars, 30+ packages): `effect` core + `@effect/platform-node|browser|bun`, `@effect/sql-pg|sqlite-node|sqlite-wasm|...`, `@effect/atom-react|vue|solid` — all `pnpm workspace`, `changesets` versioning (`docs/implement_plan/01-repository-layout.md:3` cites Effect's `pnpm + changesets + vitest` split as the surveyed template). Publishing is `core first, adapters follow` with `workspace:*` rewritten to `^` on publish.
* **Monorepo guide** (`dev.to/usapopopooon/managing-multiple-related-npm-packages-with-a-monorepo`): diagram `core <- react, core <- vue`, rule `packages that change together should live together`, `1 PR in 1 repo`, `workspaces auto-link`, `Centralized version via Changesets`.

Molt follows the same: `1 core + N adapters` under `@molt/*`, `pnpm workspace + changesets`, `files: ["dist","README.md"]`, `exports: {".": {import/require}}`, `sideEffects: false`, `publishConfig.access: public`.

## 3. Installation for users

Users install **only** what their host needs — adapters never pull an unwanted framework:

```bash
pnpm add @molt/runtime                          # any host (no React/Vite)
pnpm add @molt/runtime @molt/events             # + scoped events
pnpm add @molt/runtime @molt/react react        # React host
pnpm add @molt/runtime @molt/vite               # Vite HMR host
pnpm add @molt/runtime @molt/react @molt/vite   # React + Vite
pnpm add @molt/runtime @molt/test -D            # tests only
```

Future: `pnpm add @molt/runtime @molt/vue vue` will work the same way.

Why `peer` not `dependencies` for `@molt/runtime`? In TanStack `react-query` hides `query-core` as `dependencies` because users never touch `query-core` directly. In Molt, users **always** call `createRuntime()` from `@molt/runtime` (`docs/notes/02-core-model-and-api.md:168` `createRuntime()`), so `runtime` is a direct user dependency. Using `peer: @molt/runtime workspace:*` forces the app to declare the runtime version once and guarantees a single instance (no duplicate `Runtime` class). `changesets` rewrites `workspace:*` to `^0.x`/`^1.x` on publish, so `npm install` resolves `peer` like TanStack's `peer react` case. Keeping `peer` is intentional — do not switch adapters to `dependencies: @molt/runtime` unless you want single-install DX (`npm i @molt/react` auto-pulls runtime) at the cost of hiding the core.

## 4. Adapter contract (what makes an adapter publishable)

Every adapter in `docs/notes/05-adapters-and-host-integration.md:24` must satisfy:

1. **Charter** — `| Package | The problem it solves |` row exists. No charter = not published (`docs/notes/README.md:28`).
2. **Core never imports adapter** — `.cruiser.json:29` `adapters-depend-on-core-only: from ^packages/(test|events|react|vite)/src/ -> packages/* pathNot runtime-core`. Adding `vue` requires updating that regex to `...|vue`.
3. **Package manifest** — template `docs/implement_plan/01-repository-layout.md:92` (dual ESM/CJS, `exports` with per-condition `types`, `files: ["dist","README.md"]`, `sideEffects: false`, `engines: node >=22`, `publishConfig.access: public`). Adapter adds `peerDependencies: {"@molt/runtime":"workspace:*", "<framework>": ">=..."}`, `devDependencies: {"@molt/runtime":"workspace:*","@molt/test":"workspace:*","tsdown","@microsoft/api-extractor"}`. No runtime `dependencies`.
4. **Build** — `packages/<name>/tsdown.config.ts: platform: node, deps.neverBundle: ['@molt/runtime']`, `tsconfig.json: extends ../../tsconfig.tests.json`.
5. **API review** — `api-extractor.json`, `etc/api/<name>.api.md` committed, `pnpm check:api` green.
6. **Tests** — `vitest.config.ts` + `test/<name>.test.ts` with failure + `expectNoLeaks()` gate `docs/implement_plan/05-adapter-specs.md:107` `force a failure -> invariants hold`.

Persistence (`database.connection`, `sql`, `indexedDB`) is **host-owned**, not a package — core already guarantees `INV-12` via `Scope`, and `docs/notes/01-thesis-and-boundaries.md:51` lists `database engine` as a deliberate non-goal. `packages/sqlite` was removed for that reason.

## 5. How to add a new framework (e.g., `@molt/vue`)

Copy this checklist — no other steps are required:

1.  `mkdir packages/vue && cp packages/events/package.json packages/vue/` — edit `name: @molt/vue`, `description: Vue adapter...`, `peerDependencies: {"@molt/runtime":"workspace:*","vue":">=3"}`.
2.  `src/index.ts` — implement adapter using only `import { capability, MoltError } from '@molt/runtime'` and `Scope`; never import `packages/runtime-core/src/internal`.
3.  `tsdown.config.ts`, `tsconfig.json`, `vitest.config.ts`, `api-extractor.json`, `.prettierignore` — copy from `packages/events`.
4.  `README.md` — state problem solved (e.g., `Vue contributions unmount when generation disposed`).
5.  `.cruiser.json:32` — `^packages/(test|events|react|vite|vue)/src/`.
6.  `package.json:26,28` — add `&& pnpm --filter @molt/vue test` to `test:adapters` and `&& pnpm --filter @molt/vue exec publint` / `exec attw` to `check:pkg`.
7.  `docs/notes/05-adapters-and-host-integration.md:10` — add `runtime-vue/` to boundary + diagram `host -> runtime-vue -> runtime-core`.
8.  `docs/implement_plan/01-repository-layout.md:20` — add `vue/ # @molt/vue (P3)` to tree.
9.  `docs/implement_plan/05-adapter-specs.md` — add `## 5. @molt/vue` with Problem/Behavior, renumber `## 6. Adapter gate` -> `7`.
10. `docs/implement_plan/ledger.md:108` — add `P3-5 @molt/vue ...`, shift `P3-5` gate -> `P3-6`.
11. `README.md:91` — add `| @molt/vue | ... |` row.
12. `.changeset/pending-vue.md` — `---\n'@molt/vue': minor\n---`.
13. `docs/release-readiness.md:36` + `release.yml:90` — ` -eq 5 -> -eq 6` (or filter by `publishConfig` in future).
14. `pnpm install && pnpm build && pnpm check:arch && pnpm check:pkg && pnpm check:api && pnpm test:adapters` — all green before PR.

No core file changes, no new `dependencies` in core, no global registry.

## 6. Publishing (Changesets + OIDC)

* Versioning: `pnpm changeset` creates `.changeset/*.md`; `pnpm changeset version` bumps `packages/*/package.json` and adds `publishConfig.access` handling; `pnpm changeset publish` publishes only packages with `publishConfig.access: public` and `version !== 0.0.0` (`release.yml:146 publishable.filter(name.startsWith('@molt/'))`).
* Dry run: `release.yml:86 for package_dir in packages/*` packs each publishable and `test -eq 5` asserts count. If an internal `packages/internal-*` is added, switch to explicit allowlist or `jq '.publishConfig.access=="public"'` filter (review note on hard-delete PR).
* Provenance: `release.yml:152 environment: npm-release` + `NPM_CONFIG_PROVENANCE: true`, no long-lived token.

## 7. What not to do

* Do not add `runtime-sqlite`/`runtime-db`/`runtime-electron` as a public package unless two independent hosts need it — it violates `internal first` charter and the host-owned persistence rule that removed `sqlite`.
* Do not change `strict`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax` (`docs/implement_plan/01:58`) or add a runtime dependency to core (`semver` only `ADR-02`).
* Do not let adapters import each other (`events` -> `react` forbidden by cruiser).
