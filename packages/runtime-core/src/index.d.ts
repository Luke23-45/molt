// P0 contract declaration (ledger P0-B1): the public API surface of
// @molt/runtime, transcribed from docs/implement_plan/03-core-implementation-spec.md
// so the P0 replacement-contract tests typecheck against the real contract.
//
// This file contains TYPES ONLY — no runtime bindings exist yet, which is
// why the tests fail at import time (the designed P0 red state, plan 04 §7).
// It is DELETED at P1-D11, when the real index.ts and its modules replace it.
// If this file and plan 03 disagree, plan 03 wins — fix this file in the same
// change.

export interface Capability<T> {
  readonly id: string;
  readonly version: string;
  readonly multiple: boolean;
  readonly __type?: T;
}

export declare function capability<T>(
  id: string,
  version: string,
  options?: { readonly multiple?: boolean },
): Capability<T>;

export interface ContributionKey<T> {
  readonly id: string;
  readonly __type?: T;
}

export declare function contributionKey<T>(id: string): ContributionKey<T>;

export interface ContributionEntry {
  readonly generationId: string;
  readonly pluginId: string;
  readonly value: unknown;
}

export interface ContributionSnapshot {
  readonly entries: ReadonlyMap<string, readonly ContributionEntry[]>;
}

export interface DisposableLike {
  dispose: () => void | Promise<void>;
}

export interface Requirement {
  readonly capability: Capability<unknown>;
  readonly range: string;
  readonly optional?: boolean;
}

export interface ProvidedCapability {
  readonly capability: Capability<unknown>;
  readonly multiple?: boolean;
}

export type PluginStatus = 'installed' | 'preparing' | 'active' | 'disposing' | 'stopped';

export interface PluginContext {
  readonly pluginId: string;
  readonly generation: string;
  readonly signal: AbortSignal;
  readonly scope: Scope;
  require<T>(capability: Capability<T>): T;
  optional<T>(capability: Capability<T>): T | undefined;
  provide<T>(capability: Capability<T>, value: T): void;
  contribute<T>(key: ContributionKey<T>, value: T): void;
  diagnose(message: DiagnosticInput): void;
}

export interface Scope {
  readonly signal: AbortSignal;
  onDispose(disposer: () => void | Promise<void>): void;
  acquire<T>(create: () => T | Promise<T>, dispose: (value: T) => void | Promise<void>): Promise<T>;
  isDisposed(): boolean;
  [Symbol.asyncDispose](): Promise<void>;
}

export interface DiagnosticInput {
  readonly message: string;
  readonly severity?: 'info' | 'warning' | 'error';
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface PluginDefinition {
  readonly id: string;
  readonly version: string;
  readonly requires?: readonly Requirement[];
  readonly provides?: readonly ProvidedCapability[];
  readonly setup: (
    context: PluginContext,
  ) => void | DisposableLike | Promise<void | DisposableLike>;
}

export type RuntimeErrorCode =
  | 'DUPLICATE_PLUGIN'
  | 'INVALID_DEFINITION'
  | 'MISSING_CAPABILITY'
  | 'INCOMPATIBLE_CAPABILITY'
  | 'AMBIGUOUS_PROVIDER'
  | 'DEPENDENCY_CYCLE'
  | 'ACTIVE_DEPENDENTS'
  | 'ACTIVATION_FAILED'
  | 'DISPOSAL_FAILED'
  | 'REPLACEMENT_FAILED'
  | 'INVALID_STATE';

export interface DisposalReport {
  readonly errors: readonly unknown[];
}

export declare class MoltError extends Error {
  readonly code: RuntimeErrorCode;
  readonly pluginId?: string;
  readonly generation?: string;
  readonly capabilityId?: string;
  readonly path?: readonly string[];
  readonly details?: Readonly<Record<string, unknown>>;
  constructor(
    init: {
      code: RuntimeErrorCode;
      pluginId?: string;
      generation?: string;
      capabilityId?: string;
      path?: readonly string[];
      details?: Readonly<Record<string, unknown>>;
    },
    cause?: unknown,
  );
  static from(value: unknown, code?: RuntimeErrorCode): MoltError;
}

export declare function isMoltError(value: unknown): value is MoltError;

export interface RuntimeInspection {
  readonly plugins: readonly {
    readonly id: string;
    readonly status: PluginStatus;
    readonly generation?: string;
    readonly error?: unknown;
    readonly blockedBy?: readonly {
      readonly pluginId: string;
      readonly requirement: {
        readonly capabilityId: string;
        readonly range: string;
        readonly optional: boolean;
      };
      readonly candidates: readonly {
        readonly pluginId: string | null;
        readonly version: string;
        readonly verdict: 'incompatible' | 'stopped' | 'ambiguous' | 'ok';
      }[];
    }[];
  }[];
  readonly capabilities: readonly {
    readonly id: string;
    readonly provider: string;
    readonly version: string;
  }[];
}

export type RuntimeListener = (event: {
  readonly type: 'installed' | 'started' | 'stopped' | 'replaced' | 'failed' | 'disposed';
  readonly pluginId?: string;
  readonly generation?: string;
  readonly cascade?: readonly string[];
  readonly error?: unknown;
}) => void;

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

export interface RuntimeOptions {
  readonly providers?: readonly {
    readonly capability: Capability<unknown>;
    readonly value: unknown;
  }[];
}

export declare function createRuntime(options?: RuntimeOptions): Runtime;
