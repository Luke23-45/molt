// Resolver properties (plan 04 §3): resolution is a pure function of the
// world — identical inputs in ANY permutation produce identical plans, and
// the produced order is a valid topological order of the selected edges
// (INV-10: ambiguity/missing/conflict/cycle are structured, deterministic
// errors, never warnings).

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { PluginDefinition, PluginStatus } from '../../src/definition.js';
import { isMoltError } from '../../src/errors.js';
import type { HostProvider } from '../../src/resolver.js';
import { resolve } from '../../src/resolver.js';
import type { PluginBehaviors, World } from './generators.js';
import { arbWorld, buildDefinition, mintTokens } from './generators.js';

interface Attempt {
  readonly ok: boolean;
  readonly code?: string;
  /** JSON projection of the plan — Maps compared structurally. */
  readonly order?: readonly string[];
  readonly providers?: readonly (readonly (readonly [string, string])[])[];
  readonly edges?: readonly (readonly [string, string, string])[];
}

function attempt(world: World, definitions: readonly PluginDefinition[]): Attempt {
  const hostProviders = new Map<string, HostProvider>();
  for (const cap of world.capabilities) {
    if (cap.host) {
      hostProviders.set(cap.id, {
        capability: { id: cap.id, version: cap.hostVersion, multiple: cap.multiple },
        value: { from: '(host)', cap: cap.id },
      });
    }
  }
  const statuses = new Map<string, PluginStatus>();
  for (const definition of definitions) {
    statuses.set(definition.id, 'installed');
  }
  const root = definitions[0]?.id;
  if (root === undefined) {
    throw new Error('world has no plugins');
  }
  try {
    const plan = resolve({ definitions, statuses, hostProviders, root });
    return {
      ok: true,
      order: plan.order,
      providers: [...plan.providers.entries()].map(([, selections]) =>
        selections.map((selection) => [
          selection.pluginId ?? '(host)',
          selection.capabilityVersion,
        ]),
      ),
      edges: plan.edges.map((edge) => [edge.from, edge.to, edge.capabilityId]),
    };
  } catch (error) {
    return { ok: false, code: isMoltError(error) ? error.code : 'NON_MOLT_ERROR' };
  }
}

describe('resolver properties (plan 04 sec 3)', () => {
  const FIXED_SEED =
    process.env['FC_SEED'] !== undefined ? Number(process.env['FC_SEED']) : undefined;
  const NUM_RUNS =
    process.env['FC_NUM_RUNS'] !== undefined ? Number(process.env['FC_NUM_RUNS']) : 100;

  it(
    'INV-10: resolution is deterministic under input permutation, and its order is topological',
    { timeout: 120_000 },
    () => {
      const property = fc.property(arbWorld(), (world) => {
        const minted = mintTokens(world);
        const behaviors: PluginBehaviors = {
          serveLog: [],
          counters: { acquired: 0, released: 0 },
          contributionValues: new Map(),
        };
        // The resolver never calls setup — behavior objects are inert here.
        const definitions = world.plugins.map((plugin, index) =>
          buildDefinition(plugin, world, minted, behaviors, index),
        );
        const first = attempt(world, definitions);
        const second = attempt(world, [...definitions].reverse());
        expect(second).toEqual(first);

        if (first.ok && first.order !== undefined && first.edges !== undefined) {
          // Providers before consumers over every selected edge — the plan's
          // order covers the root's closure only, so edges from plugins
          // outside the closure have no position and are skipped.
          const position = new Map<string, number>();
          first.order.forEach((id, index) => position.set(id, index));
          for (const [from, to] of first.edges) {
            if (to === '(host)') {
              continue;
            }
            const fromPosition = position.get(from);
            const toPosition = position.get(to);
            if (fromPosition === undefined || toPosition === undefined) {
              continue;
            }
            expect(fromPosition).toBeLessThan(toPosition);
          }
        }
      });
      fc.assert(property, {
        ...(FIXED_SEED !== undefined ? { seed: FIXED_SEED } : {}),
        numRuns: NUM_RUNS,
      });
    },
  );
});
