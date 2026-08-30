// Capability tokens (plan 03 §1). The token declares the provider policy
// (note 04): single-provider by default, multi only when the factory says so.
// Tokens resolve by id, never by object identity (ADR-05) — type identity is
// a compile-time concern only.

import { MoltError } from './errors.js';
import { isValidVersion } from './internal/semver.js';

// ID grammar (plan 03 §1/§2): dotted namespaces, lowercase, no empty
// segments, no leading digits or hyphens. Shared with plugin ids.
const ID_PATTERN = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*)*$/;

export function isValidRuntimeId(id: string): boolean {
  return typeof id === 'string' && ID_PATTERN.test(id);
}

export interface Capability<T> {
  readonly id: string;
  readonly version: string;
  readonly multiple: boolean;
  /** Type phantom — never present at runtime, never read. */
  readonly __type?: T;
}

export function capability<T>(
  id: string,
  version: string,
  options?: { readonly multiple?: boolean },
): Capability<T> {
  if (!isValidRuntimeId(id)) {
    throw new MoltError({
      code: 'INVALID_DEFINITION',
      message: `invalid capability id: ${String(id)}`,
      details: { capabilityId: String(id) },
    });
  }
  if (!isValidVersion(version)) {
    throw new MoltError({
      code: 'INVALID_DEFINITION',
      message: `invalid capability version: ${String(version)}`,
      details: { capabilityId: id },
    });
  }
  // JS callers bypass the type system; the policy must still be a boolean.
  const multiple = options?.multiple;
  if (multiple !== undefined && typeof multiple !== 'boolean') {
    throw new MoltError({
      code: 'INVALID_DEFINITION',
      message: 'multiple must be a boolean',
      details: { capabilityId: id },
    });
  }
  return Object.freeze<Capability<T>>({
    id,
    version,
    multiple: multiple ?? false,
  });
}
