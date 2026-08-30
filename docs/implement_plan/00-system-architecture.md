# 00 — System Architecture

This document is the single source of truth for Molt's internal architecture. It implements notes [02](../notes/02-core-model-and-api.md) and [03](../notes/03-lifecycle-and-transactionality.md) and names everything the rest of the plan refers to.

## 1. Component map

```
host application
│
├── @molt/react     ─┐
├── @molt/vite       ├── adapters (Phase 3) — depend on core, never the reverse
├── @molt/events     │
├── @molt/sqlite    ─┘
│
└── @molt/runtime   ── runtime-core, no host, no UI, no database imports
      │
      ├── capability.ts        token factory + capability policy
      ├── definition.ts        plugin definitions + validation
      ├── errors.ts            structured error model (all codes)
      ├── resolver.ts          capability resolution, version ranges, cycles, ordering
      ├── scope.ts             ownership scopes + disposal engine
      ├── contributions.ts     staged contribution sets
      ├── runtime.ts           lifecycle engine, queues, replacement protocol
      ├── inspection.ts        snapshot + blocked-plugin diagnostics
      └── internal/
          ├── semver.ts        isolated semver wrapper (the only runtime dep)
          └── async.ts         deferreds, queues, mutex, idempotent disposer wrapper
```

Dependency direction inside core is strictly downward as drawn. `index.ts` re-exports only the public surface ([03](./03-core-implementation-spec.md) §10); `internal/` is never exported by name.

## 2. Canonical invariant registry

Every guarantee in notes [01](../notes/01-thesis-and-boundaries.md), [03](../notes/03-lifecycle-and-transactionality.md), and [06](../notes/06-validation-and-release-gates.md) is restated here exactly once, numbered, and referenced by that number everywhere else (tests, code comments, ADRs). The notes remain the prose authority; this table is the mechanical authority.

| ID | Invariant | Source |
|---|---|---|
| INV-01 | An activation failure disposes every resource acquired by that activation attempt. | notes 01 |
| INV-02 | Disposal runs in reverse acquisition order (LIFO) within one scope. | notes 01, 03 |
| INV-03 | Disposal continues after an individual disposer fails; every failure is collected. | notes 01, 03 |
| INV-04 | A scope commits at most once, and an aborted scope can never commit. | notes 01, 03 |
| INV-05 | A committed generation is disposed at most once; `dispose` is idempotent. | notes 01, 03 |
| INV-06 | Staged capabilities and contributions are invisible to any observer before commit. | notes 01, 03 |
| INV-07 | A failed replacement leaves the previous generation active and usable. | notes 01, 06 |
| INV-08 | After a replacement commits, the old generation is never restored, even if its disposal fails. | notes 03 |
| INV-09 | A plugin can only resolve capabilities its declared requirements permit. | notes 01, 04 |
| INV-10 | Ambiguity, missing requirements, version conflicts, and cycles are structured errors, never warnings. | notes 01, README |
| INV-11 | Stopping a provider with active dependents is rejected by default; cascade is explicit, ordered, and recorded. | notes 03 |
| INV-12 | Every runtime-managed resource has an owner; a disposed generation owns zero live runtime resources. | README, notes 06 |
| INV-13 | Runtime instances share no mutable state; no global registry exists. | notes 01, 02 |
| INV-14 | If old-generation disposal fails after commit, the replacement still succeeds and the failure is inspectable. | notes 03 |
| INV-15 | Replacing a provider with active dependents either replaces the whole dependent closure atomically or is rejected with a structured error; silent rebinding never happens. | notes 03 |

## 3. Runtime state model

All state lives in a `Runtime` instance. There are no module-level mutable variables anywhere in core (INV-13).

```ts
/** One installed definition plus its lifecycle bookkeeping. */
interface PluginRecord {
  definition: PluginDefinition;        // frozen at install (ADR-06)
  status: PluginStatus;                // installed | preparing | active | disposing | stopped
  activeGeneration?: Generation;       // present iff status is 'active'
  queued: Promise<unknown>;            // tail of the per-plugin operation queue
}

/** One activation of one definition. The unit of ownership. */
interface Generation {
  id: string;                          // `${pluginId}#${n}` — monotonic per runtime
  scope: Scope;                        // owns every resource of this generation
  capabilities: Map<string, ProviderBinding>;   // published at commit only
  contributions: Map<string, unknown>; // published at commit only
  diagnostics: BoundedLog<DiagnosticEntry>;     // capped ring buffer (ADR-08)
}

interface ProviderBinding {
  pluginId: string | null;             // null = host provider
  capability: Capability<unknown>;
  value: unknown;
}

interface RuntimeState {
  plugins: Map<string, PluginRecord>;
  hostProviders: Map<string, ProviderBinding>;
  generationCounter: number;           // monotonic, per runtime instance
  observers: Set<RuntimeListener>;
}
```

Capability and contribution maps are keyed by token `id`, never by token object identity: two structurally equal tokens from separately bundled copies of the factory must resolve identically (see ADR-05).

## 4. Core algorithms

Pseudocode below is binding for the implementation in [03](./03-core-implementation-spec.md). `Table §` references point into that document.

### 4.1 Resolution (resolver.ts)

Input: the installed definitions, the host providers, and the capability tokens' policies.

```
resolve(definitions, hostProviders):
  1. validate ids and versions of every definition            → INVALID_DEFINITION
  2. reject duplicate plugin ids                              → DUPLICATE_PLUGIN
  3. for each requirement R of each definition D:
       candidates = providers p where p publishes R.capability.id
                    and semver.satisfies(p.version, R.range)
       required, zero candidates → MISSING_CAPABILITY
         (diagnostic records near-misses: incompatible versions, stopped providers)
       required, ≥2 candidates, single-provider token → AMBIGUOUS_PROVIDER
       incompatible candidates exist but none compatible → INCOMPATIBLE_CAPABILITY
  4. multi-provider tokens: collect all compatible candidates in
     documented order (host first, then plugin id lexicographic)
  5. build consumer→provider edges from the selections above
  6. detect cycles over those edges (DFS with explicit stack)  → DEPENDENCY_CYCLE (full path)
  7. topologically sort with lexicographic tie-break           → deterministic order
  8. retain reverse edges as the dependents map (used by stop/cascade, INV-11)
  9. emit ResolutionPlan { order, providers, edges }           (note 04)
```

Selection, not manifest order, drives the graph (note 04). Host providers are permanent single providers; a plugin that declares `provides` for a token already held by a host provider fails validation with `AMBIGUOUS_PROVIDER` unless it is the replacement of the generation that currently holds it (INV-06 staging makes that comparison possible).

### 4.2 Activation (runtime.ts)

Implements the nine steps of note [03](../notes/03-lifecycle-and-transactionality.md) verbatim:

```
activate(id):
  1. validate definition
  2. resolve dependency closure                                (§4.1)
  3. ensure providers active — via internal activation (§5), never
     by re-entering the public start queue (deadlock, ADR-04)
  4. generation = new Generation(id, fresh scope)              status: preparing
  5. run setup(context) — context bound to this generation
  6. verify every declared provide was published via ctx.provide
  7. verify contribution ids and capability claims conflict only
     with what this generation is allowed to shadow            (INV-06)
  8. commit: publish capabilities + contributions atomically    status: active
  9. notify observers with an immutable snapshot
on any failure in 5–8: abort scope → LIFO disposal → structured error
every resource acquired in 5 is disposed (INV-01); nothing is published (INV-06)
```

### 4.3 Replacement protocol (runtime.ts)

```
replace(definition):                       // same plugin id only (note 02)
  validate new definition (id, version, capability declarations)
  if old.activeGeneration is undefined:
      delegate to activate()               // no old generation to protect
  candidate = prepare in a private scope    // old stays authoritative (INV-07)
  candidate fails → dispose candidate, keep old, throw REPLACEMENT_FAILED
  candidate ok   → commit candidate → publish → mark active
                → dispose old scope; the protocol resolves only after the
                  old-scope disposal attempt completes
                    → disposal failure: record DISPOSAL_FAILED diagnostic,
                      do NOT restore old (INV-08, INV-14)
```

If the replaced plugin's capabilities are consumed by active dependents, v1 rejects the replacement with a structured error naming the dependent path (INV-15, ADR-03). Closure-atomic replacement is a planned Phase-1.5 extension behind an explicit option; it is never a default.

### 4.4 Stop and cascade (runtime.ts)

```
stop(id, {cascade=false}):
  dependents = active plugins whose selected providers include id
  if dependents and !cascade → throw ACTIVE_DEPENDENTS (dependent path attached)
  if cascade:
     closure = reverse topological order of dependents + id
     for each plugin in closure: dispose its generation (LIFO scope)
     publish { type: 'stopped', pluginId, cascade: [...stopped ids] }
  restart is always explicit; no auto-restart exists (note 03)
```

### 4.5 Disposal engine (scope.ts)

```
Scope:
  acquire(create, dispose):
     if disposed → reject ScopeDisposedError (INV-04)
     value = await create()
     if aborted while creating → dispose value immediately, reject
     register wrapped(dispose, value)         // ownership recorded post-success
     return value
  onDispose(fn): register wrapped(fn); reject if disposed
  dispose():                                    // idempotent (INV-05)
     abort signal first — in-flight work observes it
     for entry in reverse (LIFO, INV-02):
        try entry()  catch e → errors.push(e)   // continue on failure (INV-03)
     mark disposed; return DisposalReport { errors }
  wrapped(fn): memoized — second call returns the first result, never re-runs (INV-05)
```

`dispose()` never throws; it returns an aggregated report. The runtime surfaces that report as `DISPOSAL_FAILED` diagnostics where the note-03 rules require it (INV-14). A disposed scope rejects all further acquisition (INV-04).

### 4.6 Runtime disposal (runtime.ts)

`runtime.dispose()` stops accepting new operations, stops active generations in reverse activation order, and closes every scope. A second call is a no-op returning the first result (INV-05 at runtime granularity).

## 5. Concurrency model

- **Per-plugin operation queue.** Every `start`, `stop`, and `replace` call for plugin id X is appended to X's queue; operations run strictly in call order (note 03 requires serialization per id). A queued operation re-reads state when it runs — state may have changed between enqueue and execution.
- **Definition-table lock.** `install` and `uninstall` mutate the plugin table under one async mutex, so resolution never observes a half-mutated table.
- **Internal activation path.** When activation needs a provider started (step 3), it invokes the activation routine directly instead of enqueueing a public `start` on the provider. This removes the classic lock-order deadlock (consumer's queue waits on provider's queue while the provider's activation waits on the consumer). The provider's own queue is still honored: if it has queued work, the consumer waits for the queue tail, never interleaves (ADR-04).
- **Observer re-entry.** Listeners receive immutable snapshots and may not synchronously re-enter lifecycle operations for the same plugin; violations are rejected with a structured error (note 03). Async re-entry through the public API is fine — it just queues.
- **No cancellation of running operations.** `stop` waits for `preparing` to settle; aborting a preparation is done by the scope signal, not by tearing down the queue.

## 6. Error model

One error class, `MoltError`, with: `code` (the ten codes of note [02](../notes/02-core-model-and-api.md)), `pluginId`, `generation?`, `capabilityId?`, `path?` (dependency chain), and `cause` (original error, via the standard `Error` `cause` option). `MoltError` is the *only* error type thrown by core across its public API; a non-`MoltError` escaping core is a bug (gate G6 asserts this). `MoltError.from(value)` wraps unknown throwables, preserving the cause chain.

**Required amendment to note 02:** lifecycle operations on missing-or-mis-typed states (starting an active plugin, uninstalling an active plugin, replacing an uninstalled id) need a state error. The plan adds error code `INVALID_STATE` to the code list; note 02 is amended in the same PR ([§9](#9-required-amendments-to-the-design-notes)).

## 7. Memory and leak model

Molt never uses weak references or finalizers; ownership is explicit and countable (note 06: "Use fake resources with counters"). Leak detection is therefore exact:

- the test kit's fake resources increment counters in `create` and `dispose`;
- the replace-100× stress test asserts counters return to baseline (gate T-R5, note 06);
- the property suite asserts INV-12 after every random operation;
- diagnostics are capped per generation (ADR-08) so a chatty plugin cannot grow the runtime unboundedly.

## 8. Architecture decision records

| ADR | Decision | Rationale / source |
|---|---|---|
| ADR-01 | Module set = the nine files of note 07 plus `internal/{semver,async}.ts` | note 06 requires that package exports prevent access to internals; a folder + `exports` map enforces what a flat file list cannot. |
| ADR-02 | Semver comes from the `semver` package, wrapped in `internal/semver.ts` | note 04 forbids ad-hoc comparison and mandates "one well-defined semver package"; the wrapper isolates the only core dependency and allows a test fake. |
| ADR-03 | v1 rejects provider replacement with active dependents; closure-atomic replacement comes later behind an explicit option | note 03: "must either prepare and commit the affected dependent closure together or reject"; reject-first is the smallest correct v1 (INV-15). |
| ADR-04 | Internal activation path for provider startup; no nested public queueing | prevents lock-order deadlock between per-plugin queues (§5). |
| ADR-05 | Tokens resolve by `id`, not object identity | Molt must work when a plugin and the host bundle separate copies of the factory; identity-keyed tokens would fork capability graphs silently. Type safety stays via the declared token; runtime safety via `id` + version. |
| ADR-06 | Definitions are validated and shallow-frozen at `install` | note 02: "The setup function must not mutate the definition object"; freezing makes accidental mutation an immediate error. |
| ADR-07 | Dual-format build: ESM + CJS, proper `exports` map, unbundled internals | plugin runtimes are consumed by bundlers *and* Node; SOTA packaging practice ([publint](https://publint.dev/), [attw](https://arethetypeswrong.github.io/), dual builds). Gates G7–G8 enforce it. |
| ADR-08 | Diagnostics are a capped ring buffer per generation (default 100, configurable) | note 03 requires best-effort aggregation without unbounded growth. |
| ADR-09 | `Scope` exposes `Symbol.asyncDispose`; `DisposableLike` is structurally compatible with the ECMAScript disposable protocol | note 08 obligation: `using` / `await using` must work inside plugins. |
| ADR-10 | Queued operations wait (no busy-error code in v1) | note 03 allows either policy; waiting is the least surprising. Revisit only with a demonstrated need. |
| ADR-11 | Single-source-of-truth invariant table (§2) with numbered IDs | prevents drift between notes, code comments, and tests. |
| ADR-12 | ESM is the source format; `module: nodenext`; no decorators, no `reflect-metadata`, no experimental syntax | public library consumed by many toolchains; every non-standard feature becomes a consumer's problem. |
| ADR-13 | **Target runtime is Node (≥22).** Bun is a verified secondary environment: CI imports the built `dist/` under Bun and runs a minimal lifecycle smoke test; core contains zero runtime-specific code | core does no I/O, so Bun's advantages are irrelevant to it, while a Bun-only target would contradict the host-agnostic thesis (note 01); the smoke test turns "works under Bun" into a proven claim instead of a hope. Dev toolchain stays pnpm/vitest/tsdown — those choices serve library shipping, not dev-loop speed. |

## 9. Required amendments to the design notes

The plan must not silently diverge from the notes. These amendments are applied to `docs/notes/` in the same PR that implements them:

1. **note 02** — add `INVALID_STATE` to `RuntimeErrorCode` (state errors; see [§6](#6-error-model)).
2. **note 02** — record ADR-05: capability resolution is keyed by token `id`; type identity is a compile-time concern only.
3. **note 04** — record the deterministic multi-provider ordering (host providers first, then plugin id lexicographic).
4. **note 03** — record the chosen busy policy (queue-and-wait, ADR-10).
5. **note 02** — `Runtime` gains `contributions(): ContributionSnapshot` and the `ContributionSnapshot`/`ContributionEntry` types are added to the public surface (recorded in [03 §6](./03-core-implementation-spec.md); forced by the P0-B contract tests — without a committed-snapshot read side, the INV-06 visibility claim of T-R3 is not expressible through the public API). The replacement protocol additionally resolves only after the old-scope disposal attempt completes, so INV-14's diagnostic is deterministically inspectable (T-R4) and no disposer rejection is ever floating (T-R8).

## 10. Explicitly deferred (with the phase that may revisit)

| Deferred item | Revisit in |
|---|---|
| Closure-atomic replacement of dependent closures | P1.5, behind `replace(id, { mode: 'closure' })` |
| Synchronous re-entry policy for observers | only with a written queueing policy + tests (note 03) |
| Sandbox or permission model | never in core; see note [05 §Security](../notes/05-adapters-and-host-integration.md) |
| Automatic semver-range backtracking (pick an older provider if the newest fails) | rejected for v1 — determinism beats cleverness (note 04) |
| Deno smoke test (same shape as the Bun smoke, ADR-13) | P5, optional — add when there is user demand, not before |
