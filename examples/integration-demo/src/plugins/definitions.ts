import { createEventBus, eventBusFactory } from '@molt/events';
import { reactRoute, reactWidget } from '@molt/react';
import type { PluginContext, PluginDefinition } from '@molt/runtime';
import { contributionKey } from '@molt/runtime';
import { capability } from '@molt/runtime';
import { createElement } from 'react';

import {
  analyticsCapability,
  hostConfigCapability,
  optionalLoggerCapability,
  storageCapability,
} from './storage.js';

export type DemoEvents = {
  readonly tick: { readonly seq: number };
  readonly alert: { readonly msg: string };
};

export const eventBusCapability = capability<ReturnType<typeof eventBusFactory<DemoEvents>>>(
  'demo.events',
  '1.0.0',
);

export const demoBannerKey = contributionKey<{ text: string }>('demo.banner');

/** Host-provided event bus factory */
export function hostEventFactory() {
  return eventBusFactory<DemoEvents>('sync');
}

/** Direct sync bus for isolation tests */
function directBus() {
  return createEventBus<DemoEvents>('sync');
}

// ---- Storage provider (single-provider, owns Map, LIFO + diagnostics + signal + DisposableLike) ----
export function storagePlugin(version = '1.0.0'): PluginDefinition {
  return {
    id: 'demo.storage',
    version,
    provides: [{ capability: storageCapability }],
    setup: (ctx: PluginContext) => {
      const map = new Map<string, string>();
      ctx.diagnose({ message: `storage ${version} setup`, details: { version }, severity: 'info' });
      // LIFO proof: onDispose order is LIFO at scope dispose — registered before acquire
      const order: string[] = [];
      ctx.scope.onDispose(() => {
        order.push('onDispose-outer');
      });
      // Owned resource via acquire — disposer runs LIFO after setup
      // Use a disposable Map wrapper to prove acquire ownership
      void ctx.scope.acquire(
        () => {
          return { map, order };
        },
        (res) => {
          res.order.push('acquire-dispose');
          res.map.clear();
        },
      );
      ctx.scope.onDispose(() => {
        order.push('onDispose-inner');
      });

      // Signal abort proof — long-running work should observe signal
      ctx.signal.addEventListener(
        'abort',
        () => {
          order.push('aborted');
        },
        { once: true },
      );

      ctx.provide(storageCapability, {
        get: (k) => map.get(k),
        set: (k, v) => map.set(k, v),
      });

      // Return DisposableLike — adopted before commit, proves INV-01/04 cleanup even on validation failure
      return {
        dispose: () => {
          order.push('returned-dispose');
        },
      };
    },
  };
}

// ---- Analytics multi-provider plugins (host-first ordering) ----
export function analyticsPluginA(): PluginDefinition {
  return {
    id: 'demo.analytics-a',
    version: '1.0.0',
    provides: [{ capability: analyticsCapability, multiple: true }],
    setup: (ctx) => {
      // multi-provider must publish array
      ctx.provide(analyticsCapability, ['a:pageview']);
    },
  };
}

export function analyticsPluginB(): PluginDefinition {
  return {
    id: 'demo.analytics-b',
    version: '1.0.0',
    provides: [{ capability: analyticsCapability, multiple: true }],
    setup: (ctx) => {
      ctx.provide(analyticsCapability, ['b:click']);
    },
  };
}

export function consumerMultiPlugin(): PluginDefinition {
  return {
    id: 'demo.consumer-multi',
    version: '1.0.0',
    requires: [{ capability: analyticsCapability, range: '^1.0.0' }],
    setup: (ctx) => {
      const all = ctx.require(analyticsCapability);
      // all is frozen concatenated array host + a + b in order
      ctx.diagnose({ message: `multi got ${all.join(',')}` });
      if (!Array.isArray(all)) throw new Error('multi not array');
    },
  };
}

// ---- Optional dependency consumer ----
export function optionalConsumerPlugin(): PluginDefinition {
  return {
    id: 'demo.optional-consumer',
    version: '1.0.0',
    requires: [{ capability: optionalLoggerCapability, range: '^1.0.0', optional: true }],
    setup: (ctx) => {
      const logger = ctx.optional(optionalLoggerCapability);
      // logger is undefined when not provided — must not throw
      ctx.diagnose({ message: logger === undefined ? 'optional absent' : 'optional present' });
    },
  };
}

// ---- Widget plugin (requires storage, contributes React + custom contribution) ----
export function widgetPlugin(version = '1.0.0'): PluginDefinition {
  return {
    id: 'demo.widget',
    version,
    requires: [{ capability: storageCapability, range: '^1.0.0' }],
    setup: (ctx: PluginContext) => {
      const storage = ctx.require(storageCapability);
      storage.set('mounted', version);
      // INV-06: staged contributions invisible before commit — verified in test via useContributions
      ctx.contribute(reactWidget, {
        label: `demo-widget-${version}`,
        component: () => createElement('span', null, `widget:${version}:${storage.get('mounted')}`),
      });
      ctx.contribute(reactRoute, {
        path: `/widget-${version}`,
        component: () => createElement('div', null, `route:${version}`),
      });
      ctx.contribute(demoBannerKey, { text: `banner:${version}` });

      // Scope-owned event subscription
      const bus = directBus();
      bus.on(ctx.scope, 'tick', (p) => {
        storage.set('tick', String(p.seq));
      });
      void bus.emit('tick', { seq: 1 });

      // Undeclared require must throw INV-09 — proved in test, not here
    },
  };
}

// ---- Host-config consumer (host provider must be supplied at createRuntime) ----
export function configConsumerPlugin(): PluginDefinition {
  return {
    id: 'demo.config-consumer',
    version: '1.0.0',
    requires: [{ capability: hostConfigCapability, range: '^1.0.0' }],
    setup: (ctx) => {
      const cfg = ctx.require(hostConfigCapability);
      ctx.diagnose({ message: `config env=${cfg.env}` });
    },
  };
}

// ---- Disposal stress: LIFO + continue-on-error (INV-02/03) — kept for future host recipes ----
export function disposalStressPlugin(): PluginDefinition {
  return {
    id: 'demo.disposal-stress',
    version: '1.0.0',

    setup: async (ctx) => {
      const order: string[] = [];
      await ctx.scope.acquire(
        () => ({ id: 1 }),
        // eslint-disable-next-line @typescript-eslint/require-await
        async () => {
          order.push('dispose-1');
          throw new Error('disposer-1 fail');
        },
      );
      await ctx.scope.acquire(
        () => ({ id: 2 }),
        // eslint-disable-next-line @typescript-eslint/require-await
        async () => {
          order.push('dispose-2');
        },
      );
      ctx.scope.onDispose(() => {
        order.push('onDispose-3');
      });
      // Store order on global for test to read after dispose via inspection? Use diagnose
      (globalThis as unknown as { __disposalOrder?: string[] }).__disposalOrder = order;
      // Also test Symbol.asyncDispose: plugin that returns using-like disposable
      ctx.diagnose({ message: 'disposal stress setup', details: { order: order.join(',') } });
    },
  };
}

// ---- Broken / fixed storage candidates ----
export function brokenStoragePlugin(version = '2.0.0'): PluginDefinition {
  return {
    id: 'demo.storage',
    version,
    provides: [{ capability: storageCapability }],
    setup: () => {
      throw new Error(`broken storage ${version}`);
    },
  };
}

export function fixedStoragePlugin(version = '2.0.0'): PluginDefinition {
  return storagePlugin(version);
}

// ---- Cycle pair (for resolver DEPENDENCY_CYCLE test) ----
export function cycleAPlugin(): PluginDefinition {
  const capA = capability<{ v: string }>('demo.cycle-a', '1.0.0');
  const capB = capability<{ v: string }>('demo.cycle-b', '1.0.0');
  return {
    id: 'demo.cycle-a',
    version: '1.0.0',
    provides: [{ capability: capA }],
    requires: [{ capability: capB, range: '^1.0.0' }],
    setup: (ctx) => ctx.provide(capA, { v: 'a' }),
  };
}
export function cycleBPlugin(): PluginDefinition {
  const capA = capability<{ v: string }>('demo.cycle-a', '1.0.0');
  const capB = capability<{ v: string }>('demo.cycle-b', '1.0.0');
  return {
    id: 'demo.cycle-b',
    version: '1.0.0',
    provides: [{ capability: capB }],
    requires: [{ capability: capA, range: '^1.0.0' }],
    setup: (ctx) => ctx.provide(capB, { v: 'b' }),
  };
}
