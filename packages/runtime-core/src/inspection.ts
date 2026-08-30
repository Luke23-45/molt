// Inspection (plan 03 §8): frozen snapshots over runtime state. The
// blocked-plugin tree of note 04 renders from BlockedDiagnostic data — the
// diagnostic contract is data, not text, so hosts can build their own views.

import type { DiagnosticInput, PluginStatus } from './definition.js';
import type { BlockedDiagnostic } from './resolver.js';
import type { RuntimeInspection } from './runtime.js';

export interface InspectionPluginInput {
  readonly id: string;
  readonly status: PluginStatus;
  readonly generationId?: string | undefined;
  readonly error?: unknown;
  /** Pre-extracted from a resolution failure's structured details, if any. */
  readonly blocked?: readonly BlockedDiagnostic[] | undefined;
  /** The generation's capped diagnostic log (ADR-08), when one is committed. */
  readonly diagnostics?: readonly DiagnosticInput[] | undefined;
}

export interface InspectionCapabilityInput {
  readonly id: string;
  readonly provider: string;
  readonly version: string;
}

export function buildInspection(input: {
  readonly plugins: readonly InspectionPluginInput[];
  readonly capabilities: readonly InspectionCapabilityInput[];
  readonly observerDiagnostics?: readonly {
    readonly message: string;
    readonly cause: unknown;
  }[];
}): RuntimeInspection {
  const capabilities = [...input.capabilities].sort((a, b) =>
    a.id < b.id
      ? -1
      : a.id > b.id
        ? 1
        : a.provider < b.provider
          ? -1
          : a.provider > b.provider
            ? 1
            : 0,
  );
  return Object.freeze({
    plugins: Object.freeze(
      input.plugins.map((plugin) =>
        Object.freeze({
          id: plugin.id,
          status: plugin.status,
          // exactOptionalPropertyTypes: absent fields stay absent.
          ...(plugin.generationId !== undefined ? { generation: plugin.generationId } : {}),
          ...(plugin.error !== undefined ? { error: plugin.error } : {}),
          ...(plugin.blocked !== undefined ? { blockedBy: plugin.blocked } : {}),
          ...(plugin.diagnostics !== undefined
            ? { diagnostics: Object.freeze([...plugin.diagnostics]) }
            : {}),
        }),
      ),
    ),
    capabilities: Object.freeze(capabilities.map((capability) => Object.freeze({ ...capability }))),
    observerDiagnostics: Object.freeze(
      (input.observerDiagnostics ?? []).map((entry) => Object.freeze({ ...entry })),
    ),
  });
}

/** Renders note 04's blocked-plugin tree for one diagnostic entry. */
export function formatBlockedPlugin(blocked: BlockedDiagnostic): string {
  const lines: string[] = [`${blocked.pluginId} cannot start`];
  lines.push(
    `└─ requires ${blocked.requirement.capabilityId} ${blocked.requirement.range}${
      blocked.requirement.optional ? ' (optional)' : ''
    }`,
  );
  blocked.candidates.forEach((candidate, index) => {
    const name = candidate.pluginId ?? '(host)';
    const branch = index === blocked.candidates.length - 1 ? '└─' : '├─';
    if (candidate.verdict === 'incompatible') {
      lines.push(`   ${branch} ${name} provides ${candidate.version} (incompatible)`);
    } else if (candidate.verdict === 'stopped') {
      lines.push(`   ${branch} ${name} provides ${candidate.version} but is stopped`);
    } else {
      lines.push(`   ${branch} ${name} provides ${candidate.version}`);
    }
  });
  return lines.join('\n');
}
