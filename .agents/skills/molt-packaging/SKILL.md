---
name: molt-packaging
description: Packaging and release rules for the @molt npm packages — the exports map, dual ESM/CJS build with tsdown, publint and arethetypeswrong gates, the api-extractor API review workflow, changesets with npm provenance, and the dependency policy for runtime-core. Use when changing any package.json, the public API surface, the build configuration, or when preparing a release.
license: MIT
metadata:
  author: molt
  version: "1.0"
---

# Molt packaging and release

Sources: `docs/implement_plan/01-repository-layout.md` (§2, §4), `docs/implement_plan/02-tooling-and-quality-gates.md`, `docs/implement_plan/06-ci-release-and-governance.md`, ADR-02/ADR-07/ADR-13 in `00-system-architecture.md`.

## Package manifest rules (the template is binding — 01 §4)

- `"type": "module"`, `files: ["dist", "README.md"]` — nothing accidental ships.
- `exports` has exactly one public entry plus `"./package.json"`. Internal modules are unreachable **by construction**; if something needs a second export path, that is a design conversation, not a packaging tweak.
- `sideEffects: false`; `engines: { "node": ">=22" }` (ADR-13: Node is the target; Bun is smoke-verified, not an engine).
- Adapters declare `@molt/runtime` in `peerDependencies` (workspace range mirrored), never as a hard dependency.
- `runtime-core` ships exactly one runtime dependency: `semver` (ADR-02), imported only from `internal/semver.ts`. Adding a second dependency to core is an ADR-level change.

## Build

- tsdown, dual output (ESM `dist/index.js` + CJS `dist/index.cjs`) with declarations, **unminified** — consumers run their own bundlers (ADR-07).
- ESM is the source of truth; `module: nodenext`; no decorators, no top-level await (ADR-12).

## Gates that guard the surface

| Gate | Tool | Pass condition |
|---|---|---|
| G7 | `publint` + `attw --pack` | zero errors across bundler/node10/node16 resolution |
| G8 | tarball clean install + Bun smoke | package installs and runs from the packed tarball; built ESM imports and runs a minimal lifecycle under Bun |
| G9 | `api-extractor` | public surface matches the reviewed `*.api.md` file — **any** API change requires regenerating and reviewing it in the same PR |

The public surface of `@molt/runtime` is the exact list in `docs/implement_plan/03-core-implementation-spec.md` §10 — values: `createRuntime`, `capability`, `contributionKey`, `MoltError`, `isMoltError`; plus the listed types. `Scope` and `PluginContext` are exported as types only; nothing from `internal/` is ever exported.

## Versioning and release

- **changesets** only. Never hand-edit `version` fields; never publish from a local machine state.
- Release flow (`release.yml`): full gate suite re-run → `changesets publish` with npm provenance (OIDC, `id-token: write`) → per-package git tags + GitHub Releases → regenerate `demo/comparison/RESULTS.md` on the release branch so published benchmarks cannot go stale silently.
- npm org `@molt` is claimed before first publish (note 08 naming record); the unscoped `molt` name is a dormant one-off and is not ours.
- Every changeset's description names the affected invariant(s) when the change is behavioral.

## Publish decision (P5)

Publication is gated on the six evidence items of `docs/implement_plan/06` §4 — core green, two independent hosts, regenerated benchmarks, documented limitations, zero invariant failures, and the "why a simple registry is insufficient" demo. Missing any item means the release does not happen. Keeping Molt internal is a valid outcome (note 06), and saying so plainly in the ledger is the correct move if the evidence is not there.
