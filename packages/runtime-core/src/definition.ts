// Plugin definitions (plan 03 §2). Validation runs at install and replace,
// before any scope exists; definitions are then frozen so that the note-02
// rule "setup must not mutate the definition object" becomes an immediate
// error instead of a silent bug (ADR-06).

import type { Capability } from './capability.js';
import { isValidRuntimeId } from './capability.js';
import type { ContributionKey } from './contributions.js';
import { MoltError } from './errors.js';
import { isValidRange, isValidVersion } from './internal/semver.js';
import type { Scope } from './scope.js';

export interface DisposableLike {
  dispose: () => void | Promise<void>;
}

export type PluginStatus = 'installed' | 'preparing' | 'active' | 'disposing' | 'stopped';

export interface Requirement {
  readonly capability: Capability<unknown>;
  readonly range: string;
  readonly optional?: boolean | undefined;
}

export interface ProvidedCapability {
  readonly capability: Capability<unknown>;
  readonly multiple?: boolean | undefined;
}

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

export interface DiagnosticInput {
  readonly message: string;
  readonly severity?: 'info' | 'warning' | 'error' | undefined;
  readonly details?: Readonly<Record<string, unknown>> | undefined;
}

export interface PluginDefinition {
  readonly id: string;
  readonly version: string;
  readonly requires?: readonly Requirement[] | undefined;
  readonly provides?: readonly ProvidedCapability[] | undefined;
  readonly setup: (
    context: PluginContext,
  ) => void | DisposableLike | Promise<void | DisposableLike>;
}

function invalid(message: string, details?: Record<string, unknown>): MoltError {
  return new MoltError({ code: 'INVALID_DEFINITION', message, details });
}

// Both accessors below are validated boundaries (plan 01 §6): their argument
// has already passed validateRequirement/validateProvided, so the cast is
// sound. JS callers bypass the type system — that is exactly why validation
// treats definition contents as unknown first.

function requirementCapabilityId(requirement: unknown): string {
  return (requirement as Requirement).capability.id;
}

function providedParts(provided: unknown): ProvidedCapability {
  return provided as ProvidedCapability;
}

function validateRequirement(
  requirement: unknown,
  owner: string,
  index: number,
): MoltError | undefined {
  if (typeof requirement !== 'object' || requirement === null) {
    return invalid(`requirement ${index} of ${owner} is not an object`);
  }
  // Validated boundary: object shape is asserted above, contents below.
  const req = requirement as Requirement;
  if (typeof req.capability !== 'object' || req.capability === null) {
    return invalid(`requirement ${index} of ${owner} has no capability token`);
  }
  if (!isValidRuntimeId(req.capability.id) || !isValidVersion(req.capability.version)) {
    return invalid(`requirement ${index} of ${owner} has an invalid capability token`, {
      capabilityId: String(req.capability.id),
    });
  }
  if (typeof req.range !== 'string' || !isValidRange(req.range)) {
    return invalid(`requirement ${index} of ${owner} has an invalid semver range`, {
      capabilityId: req.capability.id,
    });
  }
  return undefined;
}

function validateProvided(provided: unknown, owner: string, index: number): MoltError | undefined {
  if (typeof provided !== 'object' || provided === null) {
    return invalid(`provided capability ${index} of ${owner} is not an object`);
  }
  // Validated boundary: object shape is asserted above, contents below.
  const prov = provided as ProvidedCapability;
  if (typeof prov.capability !== 'object' || prov.capability === null) {
    return invalid(`provided capability ${index} of ${owner} has no capability token`);
  }
  if (!isValidRuntimeId(prov.capability.id) || !isValidVersion(prov.capability.version)) {
    return invalid(`provided capability ${index} of ${owner} has an invalid capability token`, {
      capabilityId: String(prov.capability.id),
    });
  }
  if (prov.multiple !== undefined && typeof prov.multiple !== 'boolean') {
    return invalid(`provided capability ${index} of ${owner} has a non-boolean multiple`, {
      capabilityId: prov.capability.id,
    });
  }
  return undefined;
}

/** Returns the first validation failure, or undefined when the definition is well-formed. */
export function validateDefinition(definition: PluginDefinition): MoltError | undefined {
  if (typeof definition !== 'object' || definition === null) {
    return invalid('plugin definition is not an object');
  }
  if (!isValidRuntimeId(definition.id)) {
    return invalid(`invalid plugin id: ${String(definition.id)}`);
  }
  const owner = definition.id;
  if (!isValidVersion(definition.version)) {
    return invalid(`invalid plugin version: ${String(definition.version)}`, { pluginId: owner });
  }
  if (typeof definition.setup !== 'function') {
    return invalid('setup must be a function', { pluginId: owner });
  }
  const requires: readonly unknown[] = definition.requires ?? [];
  if (!Array.isArray(requires)) {
    return invalid('requires must be an array', { pluginId: owner });
  }
  const provides: readonly unknown[] = definition.provides ?? [];
  if (!Array.isArray(provides)) {
    return invalid('provides must be an array', { pluginId: owner });
  }

  const requiredIds = new Set<string>();
  let index = 0;
  for (const requirement of requires) {
    const failure = validateRequirement(requirement, owner, index);
    if (failure !== undefined) {
      return failure;
    }
    const capabilityId = requirementCapabilityId(requirement);
    if (requiredIds.has(capabilityId)) {
      return invalid(`duplicate requirement for capability ${capabilityId}`, {
        pluginId: owner,
        capabilityId,
      });
    }
    requiredIds.add(capabilityId);
    index += 1;
  }

  const providedIds = new Set<string>();
  index = 0;
  for (const provided of provides) {
    const failure = validateProvided(provided, owner, index);
    if (failure !== undefined) {
      return failure;
    }
    const parts = providedParts(provided);
    const capabilityId = parts.capability.id;
    if (providedIds.has(capabilityId)) {
      return invalid(`duplicate provide for capability ${capabilityId}`, {
        pluginId: owner,
        capabilityId,
      });
    }
    providedIds.add(capabilityId);
    // The token is the authority on provider policy; a declaration that
    // disagrees with it is a definition error (plan 03 §1).
    if (parts.multiple !== undefined && parts.multiple !== parts.capability.multiple) {
      return invalid(
        `provide declaration for ${capabilityId} disagrees with the token's provider policy`,
        { pluginId: owner, capabilityId },
      );
    }
    index += 1;
  }

  for (const capabilityId of providedIds) {
    if (requiredIds.has(capabilityId)) {
      return invalid(`plugin ${owner} cannot require and provide ${capabilityId}`, {
        pluginId: owner,
        capabilityId,
      });
    }
  }
  return undefined;
}

/**
 * Shallow-freezes the definition, its arrays, and their entries (ADR-06).
 * Returns the same object, frozen.
 */
export function freezeDefinition<T extends PluginDefinition>(definition: T): T {
  Object.freeze(definition);
  if (definition.requires !== undefined) {
    Object.freeze(definition.requires);
    for (const requirement of definition.requires) {
      Object.freeze(requirement);
    }
  }
  if (definition.provides !== undefined) {
    Object.freeze(definition.provides);
    for (const provided of definition.provides) {
      Object.freeze(provided);
    }
  }
  return definition;
}
