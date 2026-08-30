// Structured error model (plan 03 §3). MoltError is the only error type core
// throws across its public API; foreign throwables enter the cause chain via
// MoltError.from — a log line is not an API (note 02).

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

export interface MoltErrorInit {
  readonly code: RuntimeErrorCode;
  readonly message: string;
  readonly pluginId?: string | undefined;
  readonly generation?: string | undefined;
  readonly capabilityId?: string | undefined;
  readonly path?: readonly string[] | undefined;
  readonly details?: Readonly<Record<string, unknown>> | undefined;
}

// Symbol.for, not Symbol: the brand must classify errors across realm and VM
// boundaries (worker hosts), which fresh symbols do not (plan 03 §3).
const BRAND: unique symbol = Symbol.for('molt.error.brand');

function buildMessage(init: MoltErrorInit): string {
  const context: string[] = [];
  if (init.pluginId !== undefined) {
    context.push(`pluginId: ${init.pluginId}`);
  }
  if (init.generation !== undefined) {
    context.push(`generation: ${init.generation}`);
  }
  if (init.capabilityId !== undefined) {
    context.push(`capabilityId: ${init.capabilityId}`);
  }
  const suffix = context.length > 0 ? ` (${context.join(', ')})` : '';
  return `[${init.code}] ${init.message}${suffix}`;
}

export class MoltError extends Error {
  readonly code: RuntimeErrorCode;
  readonly pluginId: string | undefined;
  readonly generation: string | undefined;
  readonly capabilityId: string | undefined;
  readonly path: readonly string[] | undefined;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(init: MoltErrorInit, cause?: unknown) {
    super(buildMessage(init), cause === undefined ? undefined : { cause });
    this.name = 'MoltError';
    this.code = init.code;
    this.pluginId = init.pluginId;
    this.generation = init.generation;
    this.capabilityId = init.capabilityId;
    this.path = init.path === undefined ? undefined : Object.freeze([...init.path]);
    this.details = init.details === undefined ? undefined : Object.freeze({ ...init.details });
    Object.defineProperty(this, BRAND, {
      value: true,
      enumerable: false,
      writable: false,
      configurable: false,
    });
  }

  static from(value: unknown, code: RuntimeErrorCode = 'ACTIVATION_FAILED'): MoltError {
    if (isMoltError(value)) {
      return value;
    }
    if (value === undefined) {
      return new MoltError({
        code,
        message: 'undefined thrown',
        details: { reason: 'undefined thrown' },
      });
    }
    if (value instanceof Error) {
      return new MoltError({ code, message: value.message }, value);
    }
    return new MoltError({ code, message: renderThrowable(value) }, value);
  }
}

export function isMoltError(value: unknown): value is MoltError {
  return typeof value === 'object' && value !== null && BRAND in value;
}

/** Renders a non-Error throwable without ever producing "[object Object]". */
function renderThrowable(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'object' && value !== null) {
    try {
      return JSON.stringify(value) ?? 'null';
    } catch {
      return '[unserializable throwable]';
    }
  }
  return String(value);
}
