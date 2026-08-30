# 05 — Adapter Specifications

Adapters depend on core; core knows nothing about them (note [05](../notes/05-adapters-and-host-integration.md)). Every adapter exists because its charter in note [05](../notes/05-adapters-and-host-integration.md) states a problem the core alone cannot solve. Order of construction follows note [07](../notes/07-implementation-roadmap.md) Phase 3, except the test kit, which is Phase 2 and comes first.

## 1. `@molt/test` — the test kit (P2)

**Problem it solves (charter):** replacement and leak invariants must be assertable in any host without reading runtime internals ([04 §7](./04-test-plan.md) rule 2).

### Public API

```ts
export function fakeResources(): FakeResources;   // counters + fault injection
export interface FakeResources {
  listenerHost(): ListenerResource;   // create increments 'acquired', dispose 'released'
  timerHost(): TimerResource;
  connectionHost(): ConnectionResource;
  failing(kind: keyof …): ResourceFactory;          // create or dispose throws on cue
  counters(): Readonly<Record<string, number>>;     // acquired/released/live per kind
  expectNoLeaks(): void;                            // throws with per-kind deltas
}

export function expectGenerationDisposed(rt: Runtime, pluginId: string): Promise<void>;
export function pluginHarness(definition: PluginDefinition): { run(): Promise<PluginContext>; … };
```

### Behavior requirements

- Counters are incremented *inside* the factory the plugin actually acquires through — counting is observation, never coordination.
- `failing()` fault injection is cue-based ("dispose #2 throws once") so transaction tests can be written deterministically.
- The kit never imports runtime internals — it is a host, and it must remain a plausible example host ([00 §7](./00-system-architecture.md)).

## 2. `@molt/events` — typed event capability (P3, first adapter)

**Problem it solves:** typed subscriptions that disappear with their generation; mitt/RxJS solve events, not generation-scoped subscriptions (charter table, note [05](../notes/05-adapters-and-host-integration.md)).

### Public API

```ts
export interface TypedEventCapability<TMap extends Record<string, unknown>> { … }
export const eventBusCapability: Capability<EventBusFactory>;  // host or plugin provided
```

### Behavior requirements (note 05's list, verbatim obligations)

- typed event maps — keys are the map's keys; payloads typed per key; a string-plus-`unknown` escape hatch exists but is explicitly marked unsafe (note 05: escape hatch, not API).
- synchronous vs asynchronous delivery is a bus-level choice made at capability creation, not per-emit.
- error isolation: a throwing subscriber never affects other subscribers or the emitter; errors go to the subscriber's generation diagnostics.
- ordering: synchronous buses deliver in registration order; asynchronous buses deliver in registration order per event, concurrent across events.
- a subscriber disposed mid-delivery: the in-flight callback completes, later events are not delivered, no throw surfaces to the emitter (INV-12 in adapter form — subscriptions are scope resources).
- subscriptions are acquired through the plugin's scope — disposal removes them; the adapter asserts this with `@molt/test` counters.

## 3. `@molt/react` — React adapter (P3)

**Problem it solves:** plugin UI that unmounts exactly when its generation is disposed, with per-contribution error isolation (charter, note [05](../notes/05-adapters-and-host-integration.md)).

### Public API

```ts
export const reactRoute: ContributionKey<ReactRouteContribution>;
export const reactWidget: ContributionKey<ReactWidgetContribution>;
export function RuntimeProvider(props: { runtime: Runtime; children: ReactNode }): JSX.Element;
export function useContributions<T>(key: ContributionKey<T>): readonly T[];
```

### Behavior requirements

- subscribes to committed contribution snapshots via the core observer bus; `useSyncExternalStore` with `getSnapshot` returning the frozen committed map — React never sees staged state (INV-06).
- renders only committed generations; a generation's components disappear when its scope is disposed (charter).
- an error boundary wraps each contribution's rendered output; a component error is isolated to its contribution and reported via `ctx.diagnose` — it must never tear down the runtime or sibling contributions (note 06 adapter tests).
- stale-callback prevention: contributions capture their generation id; a callback from a disposed generation is a no-op that warns in dev mode (charter: "preventing a stale component callback from mutating a newer generation").
- component state is never promised to survive replacement; the adapter's docs state this where the hooks are documented (charter).
- no React types appear in `runtime-core` (charter; enforced by gate G6's dependency-cruiser rules).

## 4. `@molt/vite` — Vite HMR bridge (P3)

**Problem it solves:** a failed module update keeps the old generation running instead of half-swapping it (charter, note [05](../notes/05-adapters-and-host-integration.md)); this is also the headline demo (note [08](../notes/08-positioning-and-related-work.md)).

### Behavior requirements (note 05's required-behavior list, binding)

| HMR event | Runtime operation |
|---|---|
| module added | `runtime.install(newDefinition)` |
| module changed | `runtime.replace(newDefinition)` |
| module removed | `runtime.uninstall(id)` — explicit, never implicit |

- module import failure → old generation stays active; the error reaches runtime diagnostics (the bridge maps `import.meta.hot` errors into `MoltError` causes, never into console-only logs).
- setup failure → old generation stays active (INV-07 through the whole bridge path).
- updates are serialized per plugin id — the bridge does not implement its own lifecycle or queue; it relies on the runtime's queues (note 05: must not create a parallel lifecycle).
- a changed *provider* triggers dependent revalidation through `replace`'s dependent path (INV-15 behavior is core's, not the bridge's).
- `import.meta.hot`, Vite's module graph, and Vite types are invisible to core (charter; gate G6).

## 5. `@molt/sqlite` — database adapter (P3, internal-first per charter)

**Problem it solves:** typed database capability with owner-and-checksum migration records; stopping a plugin never rolls back applied schema (charter, note [05](../notes/05-adapters-and-host-integration.md)).

### Behavior requirements

- exposes `database.connection` as a capability; the core never learns SQL, WASM, or IndexedDB (charter).
- migrations are ordered, immutable records with `owner` (plugin id) and `checksum` (sha-256 of the migration body).
- applying a migration is transactional within the engine; a changed checksum is a hard error (`MoltError('INVALID_STATE', details.reason = 'checksum-mismatch')`) — never a silent rerun (charter).
- plugin stop/uninstall does not roll back schema — the adapter's disposal closes connections only; the charter's "persistence ≠ lifecycle" rule is enforced by there being no rollback code at all.
- destructive data removal requires an explicit host operation, exposed as a separate host-only API with a backup policy hook — not reachable from plugin code.
- persistence failures surface as errors and diagnostics; nothing is swallowed (charter).

## 6. Adapter gate

Every adapter (P3 exit gate, note 07) passes the same final check: **force a failure in the adapter and assert core invariants hold** — React component error, Vite update failure, migration checksum mismatch, subscriber-throws — each followed by `expectNoLeaks()` and the invariant assertions of [04 §3](./04-test-plan.md). Adapters may be rewritten; the invariants may not bend.
