// The lifecycle engine (plan 00 §3–§5, 03 §7). State machine, per-plugin
// queues, the replacement protocol, cascade stops, observer bus, and
// runtime disposal live here. Invariants cited by ID are registered in
// plan 00 §2; the tests in test/replacement.test.ts and test/runtime.test.ts
// are their enforcement.

import type { Capability } from './capability.js';
import type { ContributionEntry, ContributionKey, ContributionSnapshot } from './contributions.js';
import { StagedContributions } from './contributions.js';
import type {
  DiagnosticInput,
  DisposableLike,
  PluginContext,
  PluginDefinition,
  PluginStatus,
} from './definition.js';
import { freezeDefinition, validateDefinition } from './definition.js';
import type { DisposalReport } from './errors.js';
import { isMoltError, MoltError } from './errors.js';
import { buildInspection } from './inspection.js';
import { BoundedLog, OperationQueue } from './internal/async.js';
import type { BlockedDiagnostic, HostProvider, ResolutionPlan } from './resolver.js';
import { resolve } from './resolver.js';
import { ScopeImpl } from './scope.js';

/**
 * A frozen snapshot of runtime state (plan 03 §8): plugin statuses with the
 * blocked-plugin data of note 04, the committed capability bindings (INV-06
 * — staged state never appears), and the capped diagnostic logs. Mutating
 * the snapshot cannot affect the runtime.
 *
 * @public
 */
export interface RuntimeInspection {
  readonly plugins: readonly {
    readonly id: string;
    readonly status: PluginStatus;
    readonly generation?: string;
    readonly error?: unknown;
    readonly blockedBy?: readonly BlockedDiagnostic[];
    /**
     * The generation's capped diagnostic log (ADR-08) — what the plugin
     * passed to `ctx.diagnose`, oldest first. Present only while a
     * committed generation exists; bounded by capacity, never by history.
     */
    readonly diagnostics?: readonly DiagnosticInput[];
  }[];
  readonly capabilities: readonly {
    readonly id: string;
    readonly provider: string;
    readonly version: string;
  }[];
  /**
   * Failures thrown by observers, capped (ADR-08). Observer throws never
   * propagate into lifecycle outcomes (plan 03 §7); they surface here so
   * hosts can see broken listeners.
   */
  readonly observerDiagnostics: readonly {
    readonly message: string;
    readonly cause: unknown;
  }[];
}

/**
 * One observer event (note 02). Payloads are frozen snapshots; `cascade`
 * lists the plugins stopped so far in the current cascade stop, in stop
 * order. Observer throws never affect lifecycle outcomes (plan 03 §7) —
 * they are recorded in the capped observer diagnostics.
 *
 * @public
 */
export type RuntimeListener = (event: {
  readonly type: 'installed' | 'started' | 'stopped' | 'replaced' | 'failed' | 'disposed';
  readonly pluginId?: string | undefined;
  readonly generation?: string | undefined;
  readonly cascade?: readonly string[] | undefined;
  readonly error?: unknown;
}) => void;

/**
 * The lifecycle engine surface (note 02): install, start, stop, replace,
 * uninstall, inspect, and dispose. All operations serialize per plugin id
 * (queue-and-wait, ADR-10); every failure is a structured `MoltError`
 * (INV-10). Runtime instances share nothing (INV-13).
 *
 * @public
 */
export interface Runtime {
  install(definition: PluginDefinition): void;
  uninstall(id: string): Promise<void>;
  start(id: string): Promise<void>;
  stop(id: string, options?: { readonly cascade?: boolean }): Promise<void>;
  replace(definition: PluginDefinition): Promise<void>;
  getStatus(id: string): PluginStatus | undefined;
  inspect(): RuntimeInspection;
  subscribe(listener: RuntimeListener): () => void;
  contributions(): ContributionSnapshot;
  dispose(): Promise<void>;
}

/**
 * Host-side providers supplied at construction (note 04): permanent
 * single-publisher bindings owned by the host. A plugin providing a
 * host-claimed single-provider token fails at install
 * (`AMBIGUOUS_PROVIDER`); multi-provider tokens may coexist with a host
 * provider — the host's value is served first (note 04 ordering).
 *
 * @public
 */
export interface RuntimeOptions {
  readonly providers?: readonly {
    readonly capability: Capability<unknown>;
    readonly value: unknown;
  }[];
}

/**
 * Creates a runtime instance (note 02): a self-contained plugin runtime
 * with its own definition table, bindings, and diagnostics — no global
 * registry exists (INV-13).
 *
 * @param options - Host providers and construction-time policy.
 * @throws `AMBIGUOUS_PROVIDER` when two host providers claim the same
 * capability id — host misconfiguration fails at construction, not at
 * runtime (plan 03 §5).
 * @public
 */
export function createRuntime(options?: RuntimeOptions): Runtime {
  return new RuntimeImpl(options);
}

const HOST_PROVIDER_LABEL = '(host)';
const DIAGNOSTIC_CAPACITY = 100; // ADR-08

interface PublishedBinding {
  readonly pluginId: string | null; // null = host
  readonly capability: Capability<unknown>;
  readonly value: unknown;
}

interface Generation {
  readonly id: string;
  readonly pluginId: string;
  readonly scope: ScopeImpl;
  /** capabilityId → range, from the definition this generation runs. */
  readonly consumed: { capabilityId: string; range: string }[];
  /**
   * capabilityId → generationIds of the providers this generation resolved.
   * Multi-provider tokens resolve to several providers — every one of them
   * must be tracked, or INV-11/15 miss dependents.
   */
  readonly resolvedProviders: Map<string, Set<string>>;
  /** Published token ids; filled at commit, used by withdrawal. */
  readonly providedTokenIds: string[];
  readonly diagnostics: BoundedLog<DiagnosticInput>;
}

interface PluginRecord {
  definition: PluginDefinition;
  status: PluginStatus;
  generation: Generation | undefined;
  error: unknown;
}

interface RuntimeEvent {
  readonly type: 'installed' | 'started' | 'stopped' | 'replaced' | 'failed' | 'disposed';
  readonly pluginId?: string | undefined;
  readonly generation?: string | undefined;
  readonly cascade?: readonly string[] | undefined;
  readonly error?: unknown;
}

interface RequirementLike {
  readonly capability: Capability<unknown>;
  readonly range: string;
  readonly optional?: boolean | undefined;
}

interface Selection {
  readonly pluginId: string | null;
}

class RuntimeImpl implements Runtime {
  readonly #plugins = new Map<string, PluginRecord>();
  readonly #hostProviders = new Map<string, HostProvider>();
  readonly #generations = new Map<string, Generation>();
  readonly #preparing = new Map<string, Generation>();
  // capabilityId → generationId → binding; published at commit only (INV-06).
  readonly #published = new Map<string, Map<string, PublishedBinding>>();
  // contribution keyId → generationId → entry.
  readonly #contributions = new Map<string, Map<string, ContributionEntry>>();
  readonly #activationOrder: string[] = [];
  readonly #observers = new Set<RuntimeListener>();
  readonly #observerDiagnostics = new BoundedLog<{ message: string; cause: unknown }>(
    DIAGNOSTIC_CAPACITY,
  );
  #generationCounter = 0;
  #disposed = false;
  #disposedPromise: Promise<void> | undefined;
  readonly #queue = new OperationQueue();
  #reentrancyGuard: string | undefined;

  constructor(options?: RuntimeOptions) {
    for (const provider of options?.providers ?? []) {
      if (this.#hostProviders.has(provider.capability.id)) {
        throw new MoltError({
          code: 'AMBIGUOUS_PROVIDER',
          message: `two host providers claim ${provider.capability.id}`,
          capabilityId: provider.capability.id,
        });
      }
      this.#hostProviders.set(provider.capability.id, {
        capability: provider.capability,
        value: provider.value,
      });
    }
  }

  // -- public surface --------------------------------------------------------

  install(definition: PluginDefinition): void {
    this.#assertUsable();
    const failure = validateDefinition(definition);
    if (failure !== undefined) {
      throw failure;
    }
    for (const provided of definition.provides ?? []) {
      if (!provided.capability.multiple && this.#hostProviders.has(provided.capability.id)) {
        // Host providers are permanent (plan 00 §4.1): a second single-provider
        // claim can never be selected, so it fails here instead of at start.
        // Multi-provider tokens may coexist with a host provider — the
        // documented ordering (note 04) puts the host first.
        throw new MoltError({
          code: 'AMBIGUOUS_PROVIDER',
          message: `a host provider already claims ${provided.capability.id}`,
          pluginId: definition.id,
          capabilityId: provided.capability.id,
        });
      }
    }
    if (this.#plugins.has(definition.id)) {
      throw new MoltError({
        code: 'DUPLICATE_PLUGIN',
        message: `plugin ${definition.id} is already installed`,
        pluginId: definition.id,
      });
    }
    const frozen = freezeDefinition(definition);
    this.#plugins.set(definition.id, {
      definition: frozen,
      status: 'installed',
      generation: undefined,
      error: undefined,
    });
    this.#emit({ type: 'installed', pluginId: definition.id });
  }

  uninstall(id: string): Promise<void> {
    this.#assertNotReentrant(id);
    return this.#enqueue(id, () => this.#uninstall(id));
  }

  start(id: string): Promise<void> {
    this.#assertNotReentrant(id);
    return this.#enqueue(id, () => this.#start(id));
  }

  stop(id: string, options?: { readonly cascade?: boolean }): Promise<void> {
    this.#assertNotReentrant(id);
    // A preparing plugin is stopped cooperatively: its scope signal aborts
    // NOW (plan 03 §5 — "aborting a preparation is done by the scope
    // signal"), because the queued stop below can only run after the start
    // has settled.
    const preparing = this.#preparing.get(id);
    if (preparing !== undefined) {
      void preparing.scope.dispose();
    }
    return this.#enqueue(id, () => this.#stop(id, options?.cascade === true));
  }

  replace(definition: PluginDefinition): Promise<void> {
    this.#assertNotReentrant(definition.id);
    return this.#enqueue(definition.id, () => this.#replace(definition));
  }

  getStatus(id: string): PluginStatus | undefined {
    return this.#plugins.get(id)?.status;
  }

  inspect(): RuntimeInspection {
    const plugins = [...this.#plugins.values()].map((record) => ({
      id: record.definition.id,
      status: record.status,
      generationId: record.generation?.id,
      error: record.error,
      blocked: this.#blockedOf(record),
      diagnostics: record.generation?.diagnostics.entries(),
    }));
    const capabilities: { id: string; provider: string; version: string }[] = [];
    for (const host of this.#hostProviders.values()) {
      capabilities.push({
        id: host.capability.id,
        provider: HOST_PROVIDER_LABEL,
        version: host.capability.version,
      });
    }
    for (const [capabilityId, byGeneration] of this.#published) {
      for (const binding of byGeneration.values()) {
        capabilities.push({
          id: capabilityId,
          provider: binding.pluginId ?? HOST_PROVIDER_LABEL,
          version: binding.capability.version,
        });
      }
    }
    return buildInspection({
      plugins,
      capabilities,
      observerDiagnostics: this.#observerDiagnostics.entries(),
    });
  }

  subscribe(listener: RuntimeListener): () => void {
    this.#observers.add(listener);
    return () => {
      this.#observers.delete(listener);
    };
  }

  contributions(): ContributionSnapshot {
    const entries = new Map<string, readonly ContributionEntry[]>();
    for (const [keyId, byGeneration] of this.#contributions) {
      entries.set(keyId, Object.freeze([...byGeneration.values()]));
    }
    return Object.freeze({ entries });
  }

  dispose(): Promise<void> {
    if (this.#disposedPromise !== undefined) {
      return this.#disposedPromise; // idempotent (INV-05, note 06 T-R8)
    }
    this.#disposed = true;
    const run = async (): Promise<void> => {
      // Reverse activation order (plan 00 §4.6).
      for (const generationId of [...this.#activationOrder].reverse()) {
        const generation = this.#generations.get(generationId);
        if (generation === undefined || generation.scope.isDisposed()) {
          continue;
        }
        const report = await generation.scope.dispose();
        const record = this.#plugins.get(generation.pluginId);
        if (record !== undefined) {
          record.status = 'stopped';
          record.generation = undefined;
          if (report.errors.length > 0) {
            record.error = this.#disposalFailure(generation, report);
          }
        }
        this.#withdraw(generation);
      }
      this.#emit({ type: 'disposed' });
    };
    this.#disposedPromise = run();
    return this.#disposedPromise;
  }

  // -- queue and guards --------------------------------------------------------

  #enqueue<T>(id: string, operation: () => Promise<T> | T): Promise<T> {
    return this.#queue.run(id, () => operation());
  }

  /**
   * Synchronous re-entry from an observer is rejected for the same plugin at
   * call time — a queued check would run after the emit finished and never
   * fire (plan 03 §7). Cross-plugin operations queue normally.
   */
  #assertNotReentrant(id: string): void {
    if (this.#reentrancyGuard !== undefined && this.#reentrancyGuard === id) {
      throw new MoltError({
        code: 'INVALID_STATE',
        message: 'observer re-entered a lifecycle operation synchronously',
        pluginId: id,
        details: { reason: 're-entrant-observer' },
      });
    }
  }

  #assertUsable(): void {
    if (this.#disposed) {
      throw new MoltError({
        code: 'INVALID_STATE',
        message: 'runtime is disposed',
        details: { reason: 'runtime-disposed' },
      });
    }
  }

  // -- start / activation --------------------------------------------------------

  async #start(id: string): Promise<void> {
    this.#assertUsable();
    const record = this.#requireRecord(id);
    if (record.status === 'active') {
      throw new MoltError({
        code: 'INVALID_STATE',
        message: 'plugin is already active',
        pluginId: id,
        details: { reason: 'already-active' },
      });
    }
    if (record.status === 'preparing' || record.status === 'disposing') {
      // Unreachable behind the per-plugin queue; guarded defensively.
      throw new MoltError({
        code: 'INVALID_STATE',
        message: `plugin is ${record.status}`,
        pluginId: id,
        details: { reason: 'busy' },
      });
    }

    record.status = 'preparing';
    let plan: ResolutionPlan;
    try {
      plan = resolve({
        definitions: [...this.#plugins.values()].map((entry) => entry.definition),
        statuses: this.#statuses(),
        hostProviders: this.#hostProviders,
        root: id,
      });
    } catch (error) {
      record.status = 'stopped';
      record.error = MoltError.from(error, 'ACTIVATION_FAILED');
      this.#emit({ type: 'failed', pluginId: id, error: record.error });
      throw record.error;
    }

    // Internal activation path (ADR-04): providers activate directly in
    // closure order — never by enqueueing public starts (deadlock).
    const committed: Generation[] = [];
    try {
      for (const pluginId of plan.order) {
        if (pluginId === id) {
          continue; // the root activates last
        }
        const target = this.#plugins.get(pluginId);
        if (target === undefined) {
          // Removed by a concurrent queued op while an earlier provider's
          // setup was in flight (plan 00 §5).
          throw new MoltError({
            code: 'INVALID_STATE',
            message: `provider ${pluginId} was removed during activation`,
            pluginId,
            details: { reason: 'removed-during-activation' },
          });
        }
        if (target.status === 'active') {
          continue; // live providers are reused, never restarted
        }
        if (target.status === 'preparing') {
          // ADR-04: another operation is activating this provider — wait for
          // its queue tail instead of racing or double-activating. After the
          // wait the provider is either active (reuse) or stopped (its start
          // failed; we attempt our own activation below). Re-read the status
          // after the await: it mutated across the suspension.
          await this.#queue.tail(pluginId);
          const statusAfterWait: PluginStatus | undefined = this.#plugins.get(pluginId)?.status;
          if (statusAfterWait === 'active') {
            continue;
          }
        }
        committed.push(await this.#activate(target, plan));
      }
      committed.push(await this.#activate(record, plan));
    } catch (error) {
      // INV-01: every generation committed by this attempt is disposed.
      await this.#rollback(committed);
      record.status = 'stopped';
      record.error = MoltError.from(error, 'ACTIVATION_FAILED');
      this.#emit({ type: 'failed', pluginId: id, error: record.error });
      throw record.error;
    }
  }

  /**
   * Activates one plugin: private scope, setup, provide verification,
   * conflict validation, atomic commit (plan 00 §4.2 steps 1–9). Nothing is
   * globally visible before commit (INV-06); a failure anywhere disposes the
   * candidate scope and leaves the record stopped (INV-01).
   */
  async #activate(record: PluginRecord, plan: ResolutionPlan): Promise<Generation> {
    const definition = record.definition;
    const pluginId = definition.id;
    if (record.status === 'active') {
      throw new MoltError({
        code: 'INVALID_STATE',
        message: 'plugin became active during activation',
        pluginId,
        details: { reason: 'race' },
      });
    }
    this.#generationCounter += 1;
    const generationId = `${pluginId}#${String(this.#generationCounter)}`;
    const scope = new ScopeImpl();
    const generation: Generation = {
      id: generationId,
      pluginId,
      scope,
      consumed: (definition.requires ?? []).map((requirement) => ({
        capabilityId: requirement.capability.id,
        range: requirement.range,
      })),
      resolvedProviders: new Map<string, Set<string>>(),
      providedTokenIds: [],
      diagnostics: new BoundedLog<DiagnosticInput>(DIAGNOSTIC_CAPACITY),
    };
    record.status = 'preparing';
    this.#preparing.set(pluginId, generation);
    const staged = new StagedContributions(pluginId, generationId);
    const stagedProvides = new Map<string, { capability: Capability<unknown>; value: unknown }>();
    const context = this.#buildContext(definition, generation, staged, stagedProvides, plan);

    try {
      // 5: setup. A creation error is the plugin's own error and propagates
      // raw; the catch wraps it once with identity context.
      const returned = await definition.setup(context);
      if (adoptable(returned)) {
        // Note 02: a returned disposer is adopted before any validation or
        // commit step — cleaned up on validation failure too.
        scope.onDispose(() => returned.dispose());
      }
      // 6: declared provides must have been published (note 02).
      for (const provided of definition.provides ?? []) {
        if (!stagedProvides.has(provided.capability.id)) {
          throw new MoltError({
            code: 'ACTIVATION_FAILED',
            message: `declared capability ${provided.capability.id} was never published`,
            pluginId,
            generation: generationId,
            capabilityId: provided.capability.id,
            details: { reason: 'declared-not-published' },
          });
        }
      }
      // 7: conflicts — a single-provider token may collide with no unrelated
      // active generation; multi-provider tokens coexist by design (note 04
      // aggregation, mirrored by the install-time host guard).
      for (const [tokenId, binding] of stagedProvides) {
        if (binding.capability.multiple) {
          continue;
        }
        const byGeneration = this.#published.get(tokenId);
        if (byGeneration !== undefined && byGeneration.size > 0) {
          throw new MoltError({
            code: 'AMBIGUOUS_PROVIDER',
            message: `capability ${tokenId} is already published by another active generation`,
            pluginId,
            generation: generationId,
            capabilityId: tokenId,
          });
        }
      }
      for (const keyId of staged.stagedIds()) {
        const byGeneration = this.#contributions.get(keyId);
        if (byGeneration !== undefined && byGeneration.size > 0) {
          throw new MoltError({
            code: 'ACTIVATION_FAILED',
            message: `contribution ${keyId} is owned by an unrelated active generation`,
            pluginId,
            generation: generationId,
            details: { reason: 'contribution-conflict', contributionKeyId: keyId },
          });
        }
      }
      // Dependency edges are recorded at commit from the resolution plan —
      // a plugin that never calls require() still creates a dependency
      // (INV-11/15 depend on complete edges, plan 00 §4.1 step 8).
      this.#recordResolvedProviders(definition, generation, plan);
      // 8: atomic commit — the INV-06 boundary.
      record.status = 'active';
      record.generation = generation;
      record.error = undefined;
      for (const [tokenId, binding] of stagedProvides) {
        let byGeneration = this.#published.get(tokenId);
        if (byGeneration === undefined) {
          byGeneration = new Map<string, PublishedBinding>();
          this.#published.set(tokenId, byGeneration);
        }
        byGeneration.set(generationId, {
          pluginId,
          capability: binding.capability,
          value: binding.value,
        });
        generation.providedTokenIds.push(tokenId);
      }
      for (const [keyId, entry] of staged.commit()) {
        let byGeneration = this.#contributions.get(keyId);
        if (byGeneration === undefined) {
          byGeneration = new Map<string, ContributionEntry>();
          this.#contributions.set(keyId, byGeneration);
        }
        byGeneration.set(generationId, entry);
      }
      this.#generations.set(generationId, generation);
      this.#activationOrder.push(generationId);
      this.#emit({ type: 'started', pluginId, generation: generationId });
      return generation;
    } catch (error) {
      const report = await scope.dispose();
      void report;
      record.status = 'stopped';
      record.generation = undefined;
      this.#preparing.delete(pluginId);
      throw activationError(error, pluginId, generationId);
    } finally {
      this.#preparing.delete(pluginId);
    }
  }

  // -- replacement -------------------------------------------------------------

  async #replace(definition: PluginDefinition): Promise<void> {
    this.#assertUsable();
    const failure = validateDefinition(definition);
    if (failure !== undefined) {
      throw failure;
    }
    const record = this.#plugins.get(definition.id);
    if (record === undefined) {
      throw new MoltError({
        code: 'INVALID_STATE',
        message: `replace requires an installed plugin (${definition.id})`,
        pluginId: definition.id,
        details: { reason: 'not-installed' },
      });
    }
    if (record.status === 'preparing' || record.status === 'disposing') {
      throw new MoltError({
        code: 'INVALID_STATE',
        message: `plugin is ${record.status}`,
        pluginId: definition.id,
        details: { reason: 'busy' },
      });
    }
    const frozen = freezeDefinition(definition);
    const old = record.generation;
    if (old === undefined) {
      // No active generation to protect — delegate to activation (plan 00 §4.3).
      record.definition = frozen;
      await this.#start(definition.id);
      return;
    }

    // INV-15 v1 (ADR-03): active dependents reject the replacement outright —
    // before any candidate scope exists (T-R9 asserts zero acquisitions).
    const dependents = this.#activeDependentsOf(old);
    if (dependents.length > 0) {
      throw new MoltError({
        code: 'REPLACEMENT_FAILED',
        message: `replacement of ${definition.id} has active dependents`,
        pluginId: definition.id,
        path: [...dependents.map((generation) => generation.pluginId), definition.id],
        details: { dependents: dependents.map((generation) => generation.pluginId) },
      });
    }

    // Candidate preparation — the old generation stays authoritative and
    // serving throughout (INV-07); record.status is untouched until commit.
    this.#generationCounter += 1;
    const generationId = `${definition.id}#${String(this.#generationCounter)}`;
    const scope = new ScopeImpl();
    const candidate: Generation = {
      id: generationId,
      pluginId: definition.id,
      scope,
      consumed: (frozen.requires ?? []).map((requirement) => ({
        capabilityId: requirement.capability.id,
        range: requirement.range,
      })),
      resolvedProviders: new Map<string, Set<string>>(),
      providedTokenIds: [],
      diagnostics: new BoundedLog<DiagnosticInput>(DIAGNOSTIC_CAPACITY),
    };
    const staged = new StagedContributions(definition.id, generationId);
    const stagedProvides = new Map<string, { capability: Capability<unknown>; value: unknown }>();
    const context = this.#buildContext(frozen, candidate, staged, stagedProvides, undefined);

    try {
      const returned = await frozen.setup(context);
      if (adoptable(returned)) {
        scope.onDispose(() => returned.dispose());
      }
      for (const provided of frozen.provides ?? []) {
        if (!stagedProvides.has(provided.capability.id)) {
          throw new MoltError({
            code: 'ACTIVATION_FAILED',
            message: `declared capability ${provided.capability.id} was never published`,
            pluginId: definition.id,
            generation: generationId,
            capabilityId: provided.capability.id,
            details: { reason: 'declared-not-published' },
          });
        }
      }
      // Step 7: the candidate may shadow the generation it replaces — and,
      // for multi-provider tokens, coexist with other active providers
      // (note 04); nothing else passes.
      for (const [tokenId, binding] of stagedProvides) {
        if (binding.capability.multiple) {
          continue;
        }
        const byGeneration = this.#published.get(tokenId);
        if (byGeneration === undefined) {
          continue;
        }
        for (const otherGeneration of byGeneration.keys()) {
          if (otherGeneration !== old.id) {
            throw new MoltError({
              code: 'AMBIGUOUS_PROVIDER',
              message: `capability ${tokenId} is already published by another active generation`,
              pluginId: definition.id,
              generation: generationId,
              capabilityId: tokenId,
            });
          }
        }
      }
      for (const keyId of staged.stagedIds()) {
        const byGeneration = this.#contributions.get(keyId);
        if (byGeneration === undefined) {
          continue;
        }
        for (const otherGeneration of byGeneration.keys()) {
          if (otherGeneration !== old.id) {
            throw new MoltError({
              code: 'ACTIVATION_FAILED',
              message: `contribution ${keyId} is owned by an unrelated active generation`,
              pluginId: definition.id,
              generation: generationId,
              details: { reason: 'contribution-conflict', contributionKeyId: keyId },
            });
          }
        }
      }
    } catch (error) {
      // Candidate failed: dispose it fully, keep the old generation (INV-07).
      const report = await scope.dispose();
      record.error = new MoltError(
        {
          code: 'REPLACEMENT_FAILED',
          message: `candidate replacement of ${definition.id} failed`,
          pluginId: definition.id,
          generation: generationId,
          details: report.errors.length > 0 ? { disposalErrors: report.errors } : undefined,
        },
        error,
      );
      this.#emit({ type: 'failed', pluginId: definition.id, error: record.error });
      throw record.error;
    }

    this.#recordResolvedProviders(frozen, candidate, undefined);
    // Commit (INV-06 boundary): withdraw old, publish candidate, swap the
    // generation, emit replaced — and only then dispose the old scope. The
    // protocol resolves after that disposal attempt completes (plan 00 §4.3).
    this.#withdraw(old);
    for (const [tokenId, binding] of stagedProvides) {
      let byGeneration = this.#published.get(tokenId);
      if (byGeneration === undefined) {
        byGeneration = new Map<string, PublishedBinding>();
        this.#published.set(tokenId, byGeneration);
      }
      byGeneration.set(generationId, {
        pluginId: definition.id,
        capability: binding.capability,
        value: binding.value,
      });
      candidate.providedTokenIds.push(tokenId);
    }
    for (const [keyId, entry] of staged.commit()) {
      let byGeneration = this.#contributions.get(keyId);
      if (byGeneration === undefined) {
        byGeneration = new Map<string, ContributionEntry>();
        this.#contributions.set(keyId, byGeneration);
      }
      byGeneration.set(generationId, entry);
    }
    record.definition = frozen;
    record.generation = candidate;
    record.error = undefined;
    this.#generations.set(generationId, candidate);
    this.#activationOrder.push(generationId);
    this.#emit({ type: 'replaced', pluginId: definition.id, generation: generationId });

    const report = await old.scope.dispose();
    if (report.errors.length > 0) {
      // INV-14: the replacement succeeded; the failure is inspectable and
      // the old generation is never restored (INV-08).
      record.error = this.#disposalFailure(old, report);
    }
  }

  // -- stop / cascade -------------------------------------------------------------

  async #stop(id: string, cascade: boolean): Promise<void> {
    this.#assertUsable();
    const record = this.#requireRecord(id);
    if (record.status === 'stopped') {
      return; // no-op (plan 03 §7 transition table)
    }
    if (record.status !== 'active' || record.generation === undefined) {
      throw new MoltError({
        code: 'INVALID_STATE',
        message: `stop requires an active plugin (${id} is ${record.status})`,
        pluginId: id,
        details: { reason: 'not-active' },
      });
    }
    const generation = record.generation;
    const dependents = this.#activeDependentsOf(generation);
    if (dependents.length > 0 && !cascade) {
      throw new MoltError({
        code: 'ACTIVE_DEPENDENTS',
        message: `plugin ${id} has active dependents; pass { cascade: true }`,
        pluginId: id,
        path: [...dependents.map((dependent) => dependent.pluginId), id],
        details: { dependents: dependents.map((dependent) => dependent.pluginId) },
      });
    }

    // Reverse dependency order: dependents first, deterministic (plan 00 §4.4).
    const closure: Generation[] = [];
    const visited = new Set<string>([generation.id]);
    const visit = (target: Generation): void => {
      for (const dependent of this.#activeDependentsOf(target)) {
        if (!visited.has(dependent.id)) {
          visited.add(dependent.id);
          visit(dependent);
          closure.push(dependent);
        }
      }
    };
    visit(generation);
    closure.push(generation);

    const stoppedIds: string[] = [];
    for (const target of closure) {
      const targetRecord = this.#plugins.get(target.pluginId);
      if (targetRecord !== undefined) {
        targetRecord.status = 'disposing';
      }
      const report = await target.scope.dispose();
      if (targetRecord !== undefined) {
        targetRecord.status = 'stopped';
        targetRecord.generation = undefined;
        if (report.errors.length > 0) {
          targetRecord.error = this.#disposalFailure(target, report);
        }
      }
      this.#withdraw(target);
      stoppedIds.push(target.pluginId);
      this.#emit({
        type: 'stopped',
        pluginId: target.pluginId,
        generation: target.id,
        // A frozen copy per event: sharing the growing array would let a
        // later step mutate earlier listeners' snapshots (note 03).
        cascade: cascade && closure.length > 1 ? Object.freeze([...stoppedIds]) : undefined,
      });
    }
  }

  // -- uninstall -----------------------------------------------------------------

  #uninstall(id: string): void {
    this.#assertUsable();
    const record = this.#plugins.get(id);
    if (record === undefined) {
      throw new MoltError({
        code: 'INVALID_STATE',
        message: `plugin ${id} is not installed`,
        pluginId: id,
        details: { reason: 'not-installed' },
      });
    }
    if (record.status !== 'installed' && record.status !== 'stopped') {
      throw new MoltError({
        code: 'INVALID_STATE',
        message: `uninstall requires a stopped or installed plugin (${id} is ${record.status})`,
        pluginId: id,
        details: { reason: 'not-stopped' },
      });
    }
    if (this.#activeDependentsOfPlugin(id).length > 0) {
      // Defensive: unreachable while the provider is not active; kept as a
      // structured guard (note 04 dynamic-changes rules).
      throw new MoltError({
        code: 'ACTIVE_DEPENDENTS',
        message: `plugin ${id} has active dependents`,
        pluginId: id,
      });
    }
    this.#plugins.delete(id);
  }

  // -- helpers -----------------------------------------------------------------------

  #buildContext(
    definition: PluginDefinition,
    generation: Generation,
    staged: StagedContributions,
    stagedProvides: Map<string, { capability: Capability<unknown>; value: unknown }>,
    plan: ResolutionPlan | undefined,
  ): PluginContext {
    const pluginId = generation.pluginId;
    const generationId = generation.id;
    return {
      pluginId,
      generation: generationId,
      signal: generation.scope.signal,
      scope: generation.scope,
      require: <T>(token: Capability<T>): T => {
        const requirement = definition.requires?.find((r) => r.capability.id === token.id);
        if (requirement === undefined) {
          // INV-09: the type system prevents this in TS; the runtime check
          // protects JS consumers (plan 03 §7).
          throw new MoltError({
            code: 'INVALID_STATE',
            message: `capability ${token.id} is not a declared requirement`,
            pluginId,
            generation: generationId,
            capabilityId: token.id,
            details: { reason: 'undeclared-requirement' },
          });
        }
        return this.#requirementValue(requirement, token, generation, plan) as T;
      },
      optional: <T>(token: Capability<T>): T | undefined => {
        const requirement = definition.requires?.find(
          (r) => r.capability.id === token.id && r.optional === true,
        );
        if (requirement === undefined) {
          throw new MoltError({
            code: 'INVALID_STATE',
            message: `capability ${token.id} is not a declared optional requirement`,
            pluginId,
            generation: generationId,
            capabilityId: token.id,
            details: { reason: 'undeclared-requirement' },
          });
        }
        return this.#requirementValue(requirement, token, generation, plan) as T | undefined;
      },
      provide: <T>(token: Capability<T>, value: T): void => {
        const declared = definition.provides?.some((p) => p.capability.id === token.id);
        if (declared !== true) {
          // Note 04: a plugin cannot provide a capability it did not declare.
          throw new MoltError({
            code: 'ACTIVATION_FAILED',
            message: `provided undeclared capability ${token.id}`,
            pluginId,
            generation: generationId,
            capabilityId: token.id,
          });
        }
        if (stagedProvides.has(token.id)) {
          throw new MoltError({
            code: 'ACTIVATION_FAILED',
            message: `capability ${token.id} provided twice`,
            pluginId,
            generation: generationId,
            capabilityId: token.id,
          });
        }
        if (token.multiple === true && !Array.isArray(value)) {
          // Multi-provider tokens aggregate collections: each provider
          // publishes an array, consumers receive the concatenation.
          throw new MoltError({
            code: 'ACTIVATION_FAILED',
            message: `multi-provider capability ${token.id} must be published as an array`,
            pluginId,
            generation: generationId,
            capabilityId: token.id,
          });
        }
        stagedProvides.set(token.id, { capability: token, value });
      },
      contribute: <T>(key: ContributionKey<T>, value: T): void => {
        staged.stage(key, value);
      },
      diagnose: (input: DiagnosticInput): void => {
        generation.diagnostics.push(input);
      },
    };
  }

  /**
   * Records the dependency edges of a generation at commit time — a plugin
   * that never calls require() still creates a dependency, because INV-11
   * and INV-15 need complete edges (plan 00 §4.1 step 8).
   */
  #recordResolvedProviders(
    definition: PluginDefinition,
    generation: Generation,
    plan: ResolutionPlan | undefined,
  ): void {
    for (const requirement of definition.requires ?? []) {
      const capabilityId = requirement.capability.id;
      const selections =
        plan === undefined
          ? this.#currentSelections(capabilityId)
          : (plan.providers.get(capabilityId) ?? []);
      for (const selection of selections) {
        if (selection.pluginId === null) {
          continue; // host providers are never stop/replace targets
        }
        const byGeneration = this.#published.get(capabilityId);
        if (byGeneration === undefined) {
          continue;
        }
        for (const [providerGenerationId, binding] of byGeneration) {
          if (binding.pluginId === selection.pluginId) {
            this.#recordProviderEdge(generation, capabilityId, providerGenerationId);
            break;
          }
        }
      }
    }
  }

  #recordProviderEdge(
    generation: Generation,
    capabilityId: string,
    providerGenerationId: string,
  ): void {
    const providers = generation.resolvedProviders.get(capabilityId);
    if (providers === undefined) {
      generation.resolvedProviders.set(capabilityId, new Set([providerGenerationId]));
      return;
    }
    providers.add(providerGenerationId);
  }

  #currentSelections(capabilityId: string): readonly { pluginId: string | null }[] {
    const selections: { pluginId: string | null }[] = [];
    const byGeneration = this.#published.get(capabilityId);
    if (byGeneration !== undefined) {
      for (const binding of byGeneration.values()) {
        selections.push({ pluginId: binding.pluginId });
      }
    }
    return selections;
  }

  /**
   * Resolves one declared requirement to its value (INV-09). Multi-provider
   * tokens yield every selected provider in documented order; providers are
   * recorded in `resolvedProviders` so dependent tracking works (INV-11/15).
   */
  #requirementValue(
    requirement: RequirementLike,
    token: Capability<unknown>,
    generation: Generation,
    plan: ResolutionPlan | undefined,
  ): unknown {
    const capabilityId = token.id;
    let selections: readonly Selection[];
    if (plan !== undefined) {
      const fromPlan = plan.providers.get(capabilityId);
      if (fromPlan === undefined) {
        selections = [];
      } else {
        selections = fromPlan;
      }
    } else {
      // Replacement candidates resolve against current active bindings —
      // the old generation keeps serving during preparation (INV-07).
      const current: Selection[] = [];
      if (this.#hostProviders.has(capabilityId)) {
        current.push({ pluginId: null });
      }
      const byGeneration = this.#published.get(capabilityId);
      if (byGeneration !== undefined) {
        for (const binding of byGeneration.values()) {
          current.push({ pluginId: binding.pluginId });
        }
      }
      selections = current;
    }

    if (selections.length === 0) {
      if (requirement.optional === true) {
        return undefined; // optional with nothing selected (plan 03 §5)
      }
      throw new MoltError({
        code: 'INVALID_STATE',
        message: `requirement ${capabilityId} was not resolved before setup`,
        pluginId: generation.pluginId,
        generation: generation.id,
        capabilityId,
        details: { reason: 'requirement-unresolved' },
      });
    }

    if (token.multiple === true) {
      // Each provider publishes a collection; the consumer receives the
      // concatenation in documented order (note 04).
      const values: unknown[] = [];
      for (const selection of selections) {
        const resolved = this.#bindingFor(capabilityId, selection.pluginId, generation);
        if (!Array.isArray(resolved.value)) {
          throw new MoltError({
            code: 'INVALID_STATE',
            message: `published value for multi-provider capability ${capabilityId} is not an array`,
            pluginId: generation.pluginId,
            generation: generation.id,
            capabilityId,
            details: { reason: 'requirement-unresolved' },
          });
        }
        // Boundary: Array.isArray above narrows to any[]; treat elements as
        // unknown while aggregating (plan 01 sec 6).
        const published = resolved.value as readonly unknown[];
        values.push(...published);
      }
      return Object.freeze(values);
    }
    const first = selections[0];
    if (first === undefined) {
      throw new MoltError({
        code: 'INVALID_STATE',
        message: `requirement ${capabilityId} has an empty selection`,
        pluginId: generation.pluginId,
        generation: generation.id,
        capabilityId,
        details: { reason: 'requirement-unresolved' },
      });
    }
    return this.#bindingFor(capabilityId, first.pluginId, generation).value;
  }

  #bindingFor(
    capabilityId: string,
    pluginId: string | null,
    generation: Generation,
  ): { value: unknown; generationId: string | undefined } {
    if (pluginId === null) {
      const host = this.#hostProviders.get(capabilityId);
      if (host === undefined) {
        throw new MoltError({
          code: 'INVALID_STATE',
          message: `host provider for ${capabilityId} disappeared during activation`,
          pluginId: generation.pluginId,
          generation: generation.id,
          capabilityId,
          details: { reason: 'requirement-unresolved' },
        });
      }
      return { value: host.value, generationId: undefined };
    }
    const byGeneration = this.#published.get(capabilityId);
    if (byGeneration !== undefined) {
      for (const [providerGenerationId, binding] of byGeneration) {
        if (binding.pluginId === pluginId) {
          this.#recordProviderEdge(generation, capabilityId, providerGenerationId);
          return { value: binding.value, generationId: providerGenerationId };
        }
      }
    }
    throw new MoltError({
      code: 'INVALID_STATE',
      message: `provider binding for ${capabilityId} disappeared during activation`,
      pluginId: generation.pluginId,
      generation: generation.id,
      capabilityId,
      details: { reason: 'requirement-unresolved' },
    });
  }

  #activeDependentsOf(provider: Generation): Generation[] {
    const dependents: Generation[] = [];
    for (const generationId of this.#activationOrder) {
      const generation = this.#generations.get(generationId);
      if (
        generation === undefined ||
        generation.pluginId === provider.pluginId ||
        generation.scope.isDisposed()
      ) {
        continue;
      }
      for (const providers of generation.resolvedProviders.values()) {
        if (providers.has(provider.id)) {
          dependents.push(generation);
          break;
        }
      }
    }
    return dependents;
  }

  #activeDependentsOfPlugin(pluginId: string): Generation[] {
    const dependents: Generation[] = [];
    for (const generationId of this.#activationOrder) {
      const generation = this.#generations.get(generationId);
      if (generation === undefined || generation.scope.isDisposed()) {
        continue;
      }
      for (const capabilityId of generation.resolvedProviders.keys()) {
        const byGeneration = this.#published.get(capabilityId);
        if (byGeneration === undefined) {
          continue;
        }
        for (const binding of byGeneration.values()) {
          if (binding.pluginId === pluginId) {
            dependents.push(generation);
          }
        }
      }
    }
    return dependents;
  }

  #withdraw(generation: Generation): void {
    for (const tokenId of generation.providedTokenIds) {
      const byGeneration = this.#published.get(tokenId);
      if (byGeneration !== undefined) {
        byGeneration.delete(generation.id);
        if (byGeneration.size === 0) {
          this.#published.delete(tokenId);
        }
      }
    }
    for (const [keyId, byGeneration] of this.#contributions) {
      if (byGeneration.delete(generation.id) && byGeneration.size === 0) {
        this.#contributions.delete(keyId);
      }
    }
    this.#generations.delete(generation.id);
    const orderIndex = this.#activationOrder.indexOf(generation.id);
    if (orderIndex >= 0) {
      this.#activationOrder.splice(orderIndex, 1);
    }
  }

  #disposalFailure(generation: Generation, report: DisposalReport): MoltError {
    return new MoltError({
      code: 'DISPOSAL_FAILED',
      message: `disposal of generation ${generation.id} failed`,
      pluginId: generation.pluginId,
      generation: generation.id,
      details: { errors: report.errors },
    });
  }

  #blockedOf(record: PluginRecord): readonly BlockedDiagnostic[] | undefined {
    if (!isMoltError(record.error)) {
      return undefined;
    }
    const blocked = record.error.details?.['blocked'];
    if (blocked === undefined) {
      return undefined;
    }
    // Boundary cast: the resolver constructed this exact shape (plan 03 §5).
    return blocked as readonly BlockedDiagnostic[];
  }

  #statuses(): Map<string, PluginStatus> {
    const statuses = new Map<string, PluginStatus>();
    for (const [id, record] of this.#plugins) {
      statuses.set(id, record.status);
    }
    return statuses;
  }

  #requireRecord(id: string): PluginRecord {
    const record = this.#plugins.get(id);
    if (record === undefined) {
      throw new MoltError({
        code: 'INVALID_STATE',
        message: `plugin ${id} is not installed`,
        pluginId: id,
        details: { reason: 'not-installed' },
      });
    }
    return record;
  }

  async #rollback(committed: Generation[]): Promise<void> {
    // INV-01: every resource acquired by the failed activation attempt is
    // disposed; INV-03: failures are collected, teardown continues.
    for (const generation of [...committed].reverse()) {
      if (!generation.scope.isDisposed()) {
        await generation.scope.dispose();
      }
      this.#withdraw(generation);
      const record = this.#plugins.get(generation.pluginId);
      if (record !== undefined && record.generation === generation) {
        record.status = 'stopped';
        record.generation = undefined;
      }
    }
  }

  #emit(event: RuntimeEvent): void {
    const snapshot = Object.freeze({ ...event });
    this.#reentrancyGuard = event.pluginId;
    try {
      for (const listener of this.#observers) {
        try {
          listener(snapshot);
        } catch (error) {
          // Observer failures never propagate into lifecycle outcomes
          // (plan 03 §7); they become bounded diagnostics.
          this.#observerDiagnostics.push({
            message: `observer threw during ${String(event.type)}`,
            cause: error,
          });
        }
      }
    } finally {
      this.#reentrancyGuard = undefined;
    }
  }
}

function adoptable(returned: void | DisposableLike): returned is DisposableLike {
  return (
    typeof returned === 'object' && returned !== null && typeof returned.dispose === 'function'
  );
}

function activationError(error: unknown, pluginId: string, generationId: string): MoltError {
  if (isMoltError(error)) {
    // Structured errors thrown by provide/contribute already carry identity.
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  return new MoltError(
    {
      code: 'ACTIVATION_FAILED',
      message: `setup failed: ${message}`,
      pluginId,
      generation: generationId,
    },
    error,
  );
}
