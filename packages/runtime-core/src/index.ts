// Public export surface of @molt/runtime — exactly the list in plan 03 §10.
// Gate G9 reviews every change here against the reviewed API file.
// Scope and PluginContext are types consumers receive; core is their only
// constructor. Nothing from internal/ is exported.

import { capability } from './capability.js';
import { contributionKey } from './contributions.js';
import { isMoltError, MoltError } from './errors.js';
import { createRuntime } from './runtime.js';

export { capability, contributionKey, createRuntime, isMoltError, MoltError };

export type { Capability } from './capability.js';
export type { ContributionEntry, ContributionKey, ContributionSnapshot } from './contributions.js';
export type {
  DiagnosticInput,
  DisposableLike,
  PluginContext,
  PluginDefinition,
  PluginStatus,
  ProvidedCapability,
  Requirement,
} from './definition.js';
export type { DisposalReport, RuntimeErrorCode } from './errors.js';
export type { Runtime, RuntimeInspection, RuntimeListener, RuntimeOptions } from './runtime.js';
export type { Scope } from './scope.js';
