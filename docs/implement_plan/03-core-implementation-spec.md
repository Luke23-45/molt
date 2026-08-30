# 03 — Core Implementation Specification

Module-by-module specification for `@molt/runtime`. Public shapes come from note [02](../notes/02-core-model-and-api.md) and are finalized here; behavior comes from note [03](../notes/03-lifecycle-and-transactionality.md); invariants are cited by ID from [00 §2](./00-system-architecture.md). Where this spec finalizes an underspecified detail, the decision is marked **[Decision]** and cross-referenced to its ADR.

## 0. Conventions

- Error codes are the ten codes of note 02 **plus `INVALID_STATE`** (amendment [00 §9](./00-system-architecture.md)): `DUPLICATE_PLUGIN`, `INVALID_DEFINITION`, `MISSING_CAPABILITY`, `INCOMPATIBLE_CAPABILITY`, `AMBIGUOUS_PROVIDER`, `DEPENDENCY_CYCLE`, `ACTIVE_DEPENDENTS`, `ACTIVATION_FAILED`, `DISPOSAL_FAILED`, `REPLACEMENT_FAILED`, `INVALID_STATE`.
- `@throws` annotations below list every code a function can throw. If it is not listed, it cannot be thrown.
- "Rejected" always means: throws a `MoltError` (or returns a rejected promise of one) with no partial state change.
- All validation failures carry the offending value in `MoltError.details`.

---

## 1. `capability.ts`

### Public API (finalized)

```ts
export interface Capability<T> {
  readonly id: string;
  readonly version: string;
  /** Declared at the token: single-provider (default) or multi-provider. */
  readonly multiple: boolean;
  /** Type phantom — never present at runtime. */
  readonly __type?: T;
}

export function capability<T>(
  id: string,
  version: string,
  options?: { readonly multiple?: boolean },
): Capability<T>;
```

**[Decision / ADR-05]** The token declares the provider policy (note 04: "the token must declare that policy"). `ProvidedCapability.multiple` (note 02) remains as a declaration field but is *validated to agree* with the token's policy — disagreement is `INVALID_DEFINITION`. The token is the authority.

**[Decision]** ID grammar: `^[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*)*$` — dotted namespaces like `example.clock` are valid; uppercase, leading digits, and empty segments are not. Version must be a valid semver per `internal/semver.valid`. Violations throw `MoltError('INVALID_DEFINITION')` at factory time — capability creation is eager and cheap, so bad tokens fail where they are written, not in resolution.

### Edge cases

- `capability()` returns a frozen object; calling it twice with the same arguments returns structurally equal tokens that both work (ADR-05: no identity requirement).
- `multiple: true` changes resolver behavior only; type-level, consumers of multi capabilities receive `readonly unknown[]`-shaped values (typed via the requirement's generic).
- The `__type` phantom must never be written at runtime; `capability` never reads it.

---

## 2. `definition.ts`

### Public API (finalized)

```ts
export interface PluginDefinition {
  readonly id: string;
  readonly version: string;
  readonly requires?: readonly Requirement[];
  readonly provides?: readonly ProvidedCapability[];
  readonly setup: (context: PluginContext) =>
    | void
    | DisposableLike
    | Promise<void | DisposableLike>;
}

export interface DisposableLike {
  dispose: () => void | Promise<void>;
}

export interface Requirement {
  readonly capability: Capability<unknown>;
  readonly range: string;                 // semver range, validated via internal/semver
  readonly optional?: boolean;
}

export interface ProvidedCapability {
  readonly capability: Capability<unknown>;
  readonly multiple?: boolean;            // must agree with token policy
}

export type PluginStatus =
  | 'installed' | 'preparing' | 'active' | 'disposing' | 'stopped';
```

### `validateDefinition(def): MoltError | undefined`

Checked in this order, each failure returning the named code:

1. `id` matches the plugin-id grammar (same grammar as capability ids) → `INVALID_DEFINITION`.
2. `version` is valid semver → `INVALID_DEFINITION`.
3. `setup` is a function → `INVALID_DEFINITION`.
4. `requires`/`provides` entries are well-formed; ranges are valid semver ranges → `INVALID_DEFINITION`.
5. No duplicate requirement tokens within one definition → `INVALID_DEFINITION` **[Decision]** (two requirements for the same capability is either a mistake or an undeclared multi-dependency; both are errors — INV-10 spirit).
6. No duplicate provided tokens within one definition → `INVALID_DEFINITION`.
7. Every provided token's `multiple` agrees with the token policy → `INVALID_DEFINITION`.
8. A plugin providing a token it also requires → `INVALID_DEFINITION` (self-resolution is rejected per note 04).

`install` and `replace` run `validateDefinition`, then shallow-freeze the definition and every nested array (**[Decision / ADR-06]** — note 02 forbids setup-time mutation of the definition; freezing turns a silent bug into an immediate error).

### Edge cases

- `requires: []` and `provides: []` are valid and distinct from `undefined`.
- Frozen definitions are reused across replacements without re-freeze cost (frozen is idempotent).
- `setup` returning a non-thenable non-object (e.g. `undefined`) is the `void` case, valid.

---

## 3. `errors.ts`

### Public API (finalized)

```ts
export type RuntimeErrorCode =
  | 'DUPLICATE_PLUGIN' | 'INVALID_DEFINITION' | 'MISSING_CAPABILITY'
  | 'INCOMPATIBLE_CAPABILITY' | 'AMBIGUOUS_PROVIDER' | 'DEPENDENCY_CYCLE'
  | 'ACTIVE_DEPENDENTS' | 'ACTIVATION_FAILED' | 'DISPOSAL_FAILED'
  | 'REPLACEMENT_FAILED' | 'INVALID_STATE';   // amendment 00 §9

export class MoltError extends Error {
  readonly code: RuntimeErrorCode;
  readonly pluginId?: string;
  readonly generation?: string;
  readonly capabilityId?: string;
  readonly path?: readonly string[];        // dependency chain, e.g. cycle path
  readonly details?: Readonly<Record<string, unknown>>;
  constructor(init: { code: RuntimeErrorCode } & Partial<…>, cause?: unknown);
  static from(value: unknown, code?: RuntimeErrorCode): MoltError;
}

export function isMoltError(value: unknown): value is MoltError;

export interface DisposalReport {
  readonly errors: readonly unknown[];      // INV-03: every failure collected
}
```

### Behavior

- `cause` is passed via the standard `Error` options bag (`target: es2022` gives native chaining); `MoltError.from` wraps foreign throwables, preserving `cause` chains — a log line is not an API (note 02).
- `MoltError` never mutates its `details` after construction; `details` values are shallow-frozen.
- `message` is deterministic: `"[CODE] human summary (pluginId: …, capabilityId: …)"` — greppable and test-assertable.

### Edge cases

- `MoltError.from(undefined)` produces an `ACTIVATION_FAILED`-coded error with `details.reason = 'undefined thrown'`.
- Cycle errors populate `path` with the full cycle in traversal order (note 04 requirement 6).
- `isMoltError` checks the internal brand symbol, not `instanceof` — errors crossing realm/VM boundaries in worker hosts still classify.

---

## 4. `scope.ts`

### Public API (finalized)

```ts
export interface Scope {
  readonly signal: AbortSignal;
  onDispose(disposer: () => void | Promise<void>): void;   // throws INVALID_STATE if disposed
  acquire<T>(
    create: () => T | Promise<T>,
    dispose: (value: T) => void | Promise<void>,
  ): Promise<T>;                                            // throws INVALID_STATE if disposed (rejects)
  isDisposed(): boolean;
  [Symbol.asyncDispose](): Promise<void>;                   // ADR-09
}
```

### Internal representation

```ts
interface Entry { run: () => void | Promise<void>; label?: string }
class ScopeImpl implements Scope {
  #entries: Entry[];          // LIFO by construction (INV-02)
  #controller: AbortController;
  #disposed = false;
  #disposedReport?: DisposalReport;   // INV-05: memoized
}
```

### Disposal engine (binding pseudocode in [00 §4.5](./00-system-architecture.md))

`dispose()` sequence, exactly:

1. Set `#disposed = true`; abort `#controller` (in-flight work observes it *before* cleanup begins).
2. Iterate `#entries` in reverse. For each: invoke the idempotent wrapper; sync throw or rejected promise → append to `errors`; continue (INV-03).
3. Async entries are awaited in sequence — disposal of one entry completes before the next begins (deterministic teardown; a timeout policy lives in the host adapter layer, per note 03).
4. Freeze the report, memoize it, return it.

The idempotent wrapper (`internal/async.ts`) guarantees INV-05 at resource granularity: first call runs and memoizes the result (including a rejected result); second call returns the memoized result without re-running.

### Edge cases (each is a named test in [04](./04-test-plan.md))

- `acquire` on a disposed scope → rejects `MoltError('INVALID_STATE')` (INV-04).
- `create` throws → nothing is registered; ownership never attaches to a failed creation (note 02).
- `create` succeeds *after* abort: the value is disposed immediately and `acquire` rejects — a resource is never left owned by a dead scope (INV-01/12).
- `create` resolves, `dispose` throws during a *failed activation* → the error is collected in the activation's disposal report and attached to `ACTIVATION_FAILED.details` (INV-01/03).
- `onDispose` after dispose → throws `INVALID_STATE` (late registration is a bug, not a no-op).
- Sync `setup` (non-promise) still registers the returned `DisposableLike` before any validation step — note 02's adoption rule.
- `dispose()` called concurrently twice → second caller awaits the first's report; disposers run once (INV-05).
- `signal` is aborted even when `#entries` is empty — resources may observe the signal without registering disposers.

---

## 5. `resolver.ts`

### Public API (internal — not exported from index)

```ts
interface ResolutionInput {
  definitions: readonly PluginDefinition[];        // all installed, incl. the candidate
  hostProviders: ReadonlyMap<string, ProviderBinding>;
  replacements?: ReadonlyMap<string, string>;      // pluginId → generationId allowed to shadow
}
interface ResolutionPlan {
  readonly order: readonly string[];
  readonly providers: ReadonlyMap<string, string | readonly string[]>;  // capabilityId → provider(s)
  readonly edges: readonly { from: string; to: string; reason: string }[];
}
interface BlockedDiagnostic {                      // feeds inspection (note 04 tree)
  readonly pluginId: string;
  readonly requirement: { capabilityId: string; range: string; optional: boolean };
  readonly candidates: readonly {
    pluginId: string | null; version: string;
    verdict: 'incompatible' | 'stopped' | 'ambiguous' | 'ok';
  }[];
}
```

### Algorithm

Implements [00 §4.1](./00-system-architecture.md) steps 1–9. Binding decisions:

- **Candidate pool** = host providers ∪ definitions declaring a compatible provide. A definition counts as a candidate only if it is `installed`, `active`, or `stopped`-but-startable (a `stopped` provider is listed with verdict `'stopped'` in diagnostics, never silently selected — note 04's diagnostic example).
- **Version check** = `semver.satisfies(providerVersion, range)` via `internal/semver` (ADR-02). Lexical comparison is forbidden (note 04).
- **Ordering** — [Decision]: resolution output is fully deterministic under input permutation; tests shuffle input order and assert identical plans. Multi-provider values: host providers first, then plugin providers by id lexicographic (amendment 00 §9).
- **Cycles** are detected over *selected* edges only (a provider ignored by selection cannot create a cycle). `path` is the full traversal stack at back-edge detection.
- **Deterministic activation order** = topological sort, Kahn's algorithm, ready-set as a sorted structure keyed by plugin id.

### Edge cases

- Definition requires a capability whose only compatible provider is *itself* → `DEPENDENCY_CYCLE` with path `[self, self]` (self-edges are real cycles).
- Optional requirement with zero candidates → no edge, no diagnostic, `ctx.optional` returns `undefined` (note 04).
- Optional requirement with *incompatible* candidates → edge omitted; diagnostic entry with verdict `'incompatible'` is still recorded (visibility without failure).
- Two host providers claiming the same capability id → runtime construction fails fast (`AMBIGUOUS_PROVIDER` naming both) — host misconfiguration is a construction error, not a runtime surprise.
- Empty install table + host providers only → `order: []`, plan valid.

---

## 6. `contributions.ts`

### Public API (finalized)

```ts
export interface ContributionKey<T> {
  readonly id: string;
  readonly __type?: T;
}
export function contributionKey<T>(id: string): ContributionKey<T>;
```

### Internal representation

```ts
class StagedContributions {
  #staged = new Map<string, unknown>();        // candidate-private (INV-06)
  #committed: ReadonlyMap<string, unknown>;    // visible snapshot
  stage(key, value): void;     // duplicate id in same generation → MoltError INVALID_DEFINITION
  commit(): ReadonlyMap<string, unknown>;      // once per generation (INV-04)
}
```

### Behavior

- Values are opaque to core (note 02): core never inspects shape, only key uniqueness.
- Commit swaps the snapshot atomically; the previous generation's set is withdrawn by the runtime *after* the new snapshot is published (ordering fixed by note 03's replacement diagram).
- Contribution ids are global across the runtime; a candidate that stages an id owned by an *unrelated* active generation fails validation (note 03 step 7). Shadowing the generation being replaced is allowed — that is the point of replacement.

### Edge cases

- Staging after setup resolves but before commit (async setup tail) → allowed and included in commit; staging after commit → `INVALID_STATE`.
- Same id staged for two different `ContributionKey`s in one generation → `INVALID_DEFINITION` (ids, not key objects, are the namespace — consistent with ADR-05).

---

## 7. `runtime.ts`

The lifecycle engine. Public API is exactly note 02's `Runtime`, `RuntimeOptions`, `RuntimeListener`, with the note-03 busy policy (ADR-10: queue-and-wait).

### State transition table (binding)

| From \ Event | `start(id)` | `stop(id)` | `replace(def)` | `uninstall(id)` |
|---|---|---|---|---|
| `installed` | → preparing | `INVALID_STATE` | `INVALID_STATE` | ok (removed) |
| `preparing` | queued | queued | queued | queued |
| `active` | `INVALID_STATE` | → disposing → stopped | replacement protocol | `INVALID_STATE` (stop first) |
| `disposing` | queued | queued (no-op) | queued | queued |
| `stopped` | → preparing | no-op | replacement protocol | ok (removed; persisted data untouched — README rule) |
| not installed | `INVALID_STATE` (see decision below) | `INVALID_STATE` | `INVALID_STATE` (note 02: replace needs an installed id) | `INVALID_STATE` |

`start` of a never-installed id throws `INVALID_STATE` with `details.reason = 'not-installed'` **[Decision]** — `MISSING_CAPABILITY` is reserved for capability resolution failures (note 02), not plugin identity.

### Activation path

Implements [00 §4.2](./00-system-architecture.md). The `PluginContext` handed to setup:

- `require(token)` → value from the resolution plan only (INV-09); a plugin calling `require` for an undeclared token gets `MoltError('INVALID_STATE', details.reason = 'undeclared-requirement')` — the type system already prevents this in TS; the runtime check protects JS consumers.
- `provide(token, value)` → staged; validated at step 6 (declared-but-never-published → `ACTIVATION_FAILED`, note 02).
- `contribute(key, value)` → staged (§6).
- `signal` / `scope` — the generation's own; cleanup is the scope's job, never a second context (note 02).
- `diagnose(input)` → appends to the generation's capped log (ADR-08).

Provider startup uses the internal activation path (ADR-04): the consumer's activation directly runs the provider's activation routine after (a) verifying the provider's queue is empty or waiting on its tail, and (b) recording the provider's generation as active before the consumer's setup runs.

### Replacement path

Implements [00 §4.3](./00-system-architecture.md) exactly. Additional binding decisions:

- Pre-validation of the candidate (`validateDefinition` + declared-capability diff against the old generation's provides) runs *before* any scope is created — a version regression on a provided capability fails without touching the old generation (note 02: "validate … before preparing its candidate generation").
- Dependent check (INV-15 v1 = reject): if the resolution plan shows active dependents on any capability the old generation provides and the candidate does not provide compatibly, throw `REPLACEMENT_FAILED` with `path` = dependent chain. **No rebinding.**
- Commit ordering is fixed: publish candidate snapshot → mark candidate active → *then* dispose old scope. Old-scope disposal runs even if the host never awaits it; its report becomes a `DISPOSAL_FAILED` diagnostic (INV-14), never a rollback (INV-08).

### Stop / cascade / uninstall

Per [00 §4.4](./00-system-architecture.md). `uninstall` rules (note 04): active plugin → `INVALID_STATE` (stop first); dependents of a *stopped-but-installed* plugin are irrelevant to uninstall; uninstall never touches persistence (README rule — there is no persistence in core, so this invariant is structural: core has no API to delete anything but runtime state).

### Runtime disposal

`runtime.dispose()`: reject new operations with `INVALID_STATE`; stop all active generations in reverse activation order; await all scope reports; aggregate a final `DISPOSAL_FAILED` diagnostics list. Idempotent (INV-05, note 06 transaction test 8).

### Observer bus

- Listeners receive one frozen snapshot per event; event payloads are `{ type, pluginId?, generation?, cascade?, error? }` (note 02).
- Listener throw → the error is caught, recorded as a diagnostic (`OBSERVER_FAILED` entry in the capped log), and never propagates into lifecycle outcomes — observers must not be able to break activation (note 03: observers cannot mutate runtime internals).
- Synchronous re-entry attempt (a listener calling `start`/`stop` on the same plugin from within the callback) → `MoltError('INVALID_STATE', details.reason = 're-entrant-observer')` (note 03).

### Edge cases (named tests in [04](./04-test-plan.md))

- Setup provides a capability it did not declare → `ACTIVATION_FAILED` (note 04: "a plugin cannot provide a capability it did not declare").
- Setup resolves after its scope was aborted (host called `stop` during `preparing`) → activation completes as failure; candidate disposed; status `stopped`; no partial publication (INV-06).
- `replace` with a definition whose `id` differs from the installed one → `INVALID_STATE` (note 02 scope rule).
- 100 sequential `replace` calls → generation counter grows, resource counters return to baseline (note 06 test 5).
- Two runtimes in one process, same plugin ids → fully independent (INV-13; note 06 unit list).

---

## 8. `inspection.ts`

### Public API (finalized — note 02 shape, extended for blocked plugins)

```ts
export interface RuntimeInspection {
  readonly plugins: readonly {
    id: string; status: PluginStatus; generation?: string; error?: unknown;
    blockedBy?: readonly BlockedDiagnostic;   // present iff start failed on resolution
  }[];
  readonly capabilities: readonly {
    id: string; provider: string; version: string;
  }[];
}
```

### Behavior

- `inspect()` returns a fresh frozen snapshot; mutating it cannot affect the runtime (note 03: immutable snapshots).
- The blocked-plugin tree of note 04 (`example.consumer cannot start └─ requires storage >= 2.0.0 …`) is a *renderer* over `BlockedDiagnostic`; the renderer lives in inspection, the data lives in the resolver — the diagnostic contract is data, not text.
- `capabilities` lists committed generations and host providers only (INV-06); staged entries never appear.

### Edge cases

- Inspection during `preparing` shows the *old* generation (or none) — candidates are invisible until commit (INV-06).
- After INV-14 failure, the new generation is listed with its `DISPOSAL_FAILED` diagnostic attached — the failure is inspectable, not merely logged.

---

## 9. `internal/`

- **`semver.ts`** — re-exports `valid`, `satisfies`, `compare` from `semver` behind domain-named functions; the only file allowed to import `semver` (ADR-02). Ranges are validated once at requirement-validation time; resolution only calls `satisfies`.
- **`async.ts`** — `createDeferred<T>`, `AsyncMutex` (definition-table lock), `OperationQueue` (per-plugin-id tails), `idempotent(fn)` wrapper, `BoundedLog<T>` (ring buffer, ADR-08). No domain types; fully unit-tested in isolation because scope and runtime correctness compose from these.

## 10. Public export surface (`index.ts`)

Exactly this list — gate G9 enforces the reviewed API file against it:

```ts
// values
createRuntime;
capability;
contributionKey;
MoltError;
isMoltError;
// types
Runtime, RuntimeOptions, RuntimeListener, RuntimeInspection,
PluginDefinition, PluginContext, PluginStatus,
Capability, Requirement, ProvidedCapability,
ContributionKey, ContributionSnapshot, DiagnosticInput,
Scope, DisposableLike, DisposalReport, RuntimeErrorCode
```

`Scope` and `PluginContext` are exported as *types consumers receive*; they are constructed only by core. Nothing from `internal/` is exported; the `exports` map makes that structurally true ([01 §4](./01-repository-layout.md)).
