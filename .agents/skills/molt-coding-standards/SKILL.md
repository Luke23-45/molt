---
name: molt-coding-standards
description: TypeScript and code-style rules for all Molt packages — strict compiler options, the file-by-file contract for runtime-core, the MoltError model with its 11 error codes, comment and JSDoc policy, and the forbidden-constructs list. Use when writing, refactoring, or reviewing any TypeScript code in packages/, examples/, or demo/.
license: MIT
metadata:
  author: moltjs
  version: "1.0"
---

# Molt coding standards

Full sources: `docs/implement_plan/01-repository-layout.md` (§3–§7) and `docs/implement_plan/03-core-implementation-spec.md` (§0). This skill is the working summary; the plan documents win on any conflict.

## Compiler contract (non-negotiable)

`strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax`, `isolatedModules`, `module: nodenext`, `target: es2022`, `declaration: true`. `lib` excludes DOM in core — a DOM reference must fail typecheck (reinforces gate G6), never be "fixed" by adding the DOM lib.

## File-by-file contract for `runtime-core`

Each file owns exactly one responsibility (full table: `docs/implement_plan/01-repository-layout.md` §5):

| File | Owns | Must never contain |
|---|---|---|
| `capability.ts` | token factory, policy, id/version grammar | resolution, runtime state |
| `definition.ts` | definition types, validation, freeze | lifecycle, scope logic |
| `errors.ts` | `MoltError`, codes, `DisposalReport` | throwing beyond constructors |
| `resolver.ts` | graph, selection, ranges, cycles, order | I/O, timing, lifecycle |
| `scope.ts` | `Scope`, disposal engine, idempotent wrapper | capability knowledge |
| `contributions.ts` | staged sets, commit/withdraw | rendering, host concepts |
| `runtime.ts` | lifecycle engine, queues, replacement | algorithm details of resolver/scope |
| `inspection.ts` | snapshots, blocked-plugin renderer | mutation of runtime state |
| `internal/semver.ts` | the only `semver` import (ADR-02) | anything else |
| `internal/async.ts` | deferreds, mutex, queues, wrapper, bounded log | domain types |
| `index.ts` | public re-export surface only | logic |

Violating a "must never contain" is a review-blocking error even if the code works — it is how the architecture rots.

## Code rules

- **Named exports only**; no default exports in core.
- **`readonly`** on every conceptually immutable property; public snapshots use `readonly` arrays and `ReadonlyMap`/`ReadonlySet` so callers cannot mutate runtime state.
- **No `any`. No non-null assertions. No `as` except at validated boundaries** — each such cast carries a comment stating the invariant that makes it sound.
- **Errors:** core throws only `MoltError`. Wrap foreign throwables with `MoltError.from(value)`. Never swallow errors; never `console.*` — diagnostics flow through `ctx.diagnose` and observer events.
- **Comments** state constraints and cite invariant IDs (`// INV-03: continue after failure`), never narrate the next line. If a line needs narration, restructure the line.
- **JSDoc on every export**, each `@throws` listing its exact error codes. The API-review gate (G9) fails on undocumented exports.
- **Imports:** `node:` builtins, external packages, then internal `./` — lint-enforced order.
- **Forbidden:** decorators, enums (use string-literal unions), namespaces, top-level await, `Symbol`-keyed global registries, module-level mutable state (INV-13), polyfills for `AbortController`/`EventTarget` (Node ≥22 and browsers have them).

## Error model (the 11 codes — `docs/implement_plan/03` §0)

`DUPLICATE_PLUGIN`, `INVALID_DEFINITION`, `MISSING_CAPABILITY`, `INCOMPATIBLE_CAPABILITY`, `AMBIGUOUS_PROVIDER`, `DEPENDENCY_CYCLE`, `ACTIVE_DEPENDENTS`, `ACTIVATION_FAILED`, `DISPOSAL_FAILED`, `REPLACEMENT_FAILED`, `INVALID_STATE`.

Usage discipline: `MISSING_CAPABILITY`/`INCOMPATIBLE_CAPABILITY`/`AMBIGUOUS_PROVIDER`/`DEPENDENCY_CYCLE` are resolution failures only; state problems (start on active, replace uninstalled, uninstall active, disposed-scope access, observer re-entry) are `INVALID_STATE` with `details.reason`. Capability access outside declared requirements is `INVALID_STATE` (`details.reason = 'undeclared-requirement'`), never a dynamic lookup.

`message` format is deterministic — `"[CODE] summary (pluginId: …)"` — because tests assert codes and messages, not stack traces.

## A shortcut that is always wrong

"Couple these two modules to save a file," "make the scope disposable twice for convenience," "let setup return the context for mutation," "store the runtime on globalThis for ergonomics." Each contradicts a named invariant or ADR; each has failed in other libraries; none is open for renegotiation in a PR.
