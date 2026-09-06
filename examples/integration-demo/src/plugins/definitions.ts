import { createEventBus, eventBusFactory } from '@molt/events';
import { reactRoute, reactWidget } from '@molt/react';
import type { PluginContext, PluginDefinition } from '@molt/runtime';
import { contributionKey } from '@molt/runtime';
import { capability } from '@molt/runtime';
import { createElement } from 'react';

import {
  analyticsCapability,
  cascadeRootCapability,
  hostConfigCapability,
  notificationCapability,
  optionalLoggerCapability,
  storageCapability,
  versionedCapability,
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

export const demoToastKey = contributionKey<{ message: string }>('demo.toast');

/** Host-provided event bus factory — host owns mode, plugins call create() */
export function hostEventFactory() {
  return eventBusFactory<DemoEvents>('sync');
}

/** Direct sync bus for isolated subscription tests */
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
      // LIFO proof: onDispose order is LIFO at scope dispose — registered before acquire INV-02
      const order: string[] = [];
      ctx.scope.onDispose(() => {
        order.push('onDispose-outer');
      });
      // Owned resource via acquire — disposer runs LIFO after setup INV-01
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

      // Signal abort proof — long-running work should observe signal INV-12
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
      // multi-provider must publish array INV-11
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
      // all is frozen concatenated array host + a + b in order INV-11
      ctx.diagnose({ message: `multi got ${all.join(',')}` });
      if (!Array.isArray(all)) throw new Error('multi not array');
      if (!Object.isFrozen(all)) throw new Error('multi should be frozen');
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
      // logger is undefined when not provided — must not throw INV-09
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

      // Scope-owned event subscription INV-12
      const bus = directBus();
      bus.on(ctx.scope, 'tick', (p) => {
        storage.set('tick', String(p.seq));
      });
      void bus.emit('tick', { seq: 1 });
    },
  };
}

// ---- Host-config consumer (host provider must be supplied at createRuntime) ----
export function configConsumerPlugin(): PluginDefinition {
  return {
    id: 'demo.config-consumer',
    version: '1.0.0',
    requires: [
      { capability: hostConfigCapability, range: '^1.0.0' },
      { capability: optionalLoggerCapability, range: '^1.0.0', optional: true },
    ],
    setup: (ctx) => {
      const cfg = ctx.require(hostConfigCapability);
      ctx.diagnose({ message: `config env=${cfg.env}` });
      // Also exercise optional host logger when present INV-09
      const maybeLogger = ctx.optional(optionalLoggerCapability);
      void maybeLogger;
    },
  };
}

// ---- Real-project: Dashboard that uses host logger, notifications, storage, event factory ----
export function dashboardPlugin(): PluginDefinition {
  return {
    id: 'demo.dashboard',
    version: '1.0.0',
    requires: [
      { capability: storageCapability, range: '^1.0.0' },
      { capability: hostConfigCapability, range: '^1.0.0' },
    ],
    provides: [{ capability: notificationCapability }],
    setup: (ctx) => {
      const storage = ctx.require(storageCapability);
      const config = ctx.require(hostConfigCapability);
      ctx.diagnose({ message: `dashboard env=${config.env}`, severity: 'info' });
      storage.set('dashboard:ready', 'true');

      // Provide notifications capability
      ctx.provide(notificationCapability, {
        notify: (msg: string) => {
          // guard generation pattern — caller wraps with guardGenerationCallback in host
          ctx.diagnose({ message: `notify:${msg}`, severity: 'info' });
        },
      });

      // Contribute toast only — dashboard's widget/route would collide with widget plugin's single-owner contributions (plan 00 §4.2 step 7)
      ctx.contribute(demoToastKey, { message: `welcome ${config.env}` });

      // Use event bus factory provided by host (tests host provider + factory pattern)
      // In real host we pass eventBusCapability as host provider; plugin can require it
      // Here we also do direct bus scoped subscription to prove generation-scoped events
      const bus = createEventBus<DemoEvents>('sync');
      bus.on(ctx.scope, 'alert', (p) => {
        storage.set('last-alert', p.msg);
      });
    },
  };
}

// ---- Notification consumer that depends on dashboard's notification capability ----
export function notificationConsumerPlugin(): PluginDefinition {
  return {
    id: 'demo.notification-consumer',
    version: '1.0.0',
    requires: [{ capability: notificationCapability, range: '^1.0.0' }],
    setup: (ctx) => {
      const svc = ctx.require(notificationCapability);
      svc.notify('consumer-mounted');
      ctx.diagnose({ message: 'notification consumer active' });
    },
  };
}

// ---- Cascade root + dependent (ACTIVE_DEPENDENTS + cascade stop exercise) ----
export function cascadeRootPlugin(): PluginDefinition {
  return {
    id: 'demo.cascade-root',
    version: '1.0.0',
    provides: [{ capability: cascadeRootCapability }],
    setup: (ctx) => {
      ctx.provide(cascadeRootCapability, { id: 'root' });
    },
  };
}

export function cascadeDependentPlugin(): PluginDefinition {
  return {
    id: 'demo.cascade-dependent',
    version: '1.0.0',
    requires: [{ capability: cascadeRootCapability, range: '^1.0.0' }],
    setup: (ctx) => {
      void ctx.require(cascadeRootCapability);
      ctx.diagnose({ message: 'cascade dependent active' });
    },
  };
}

// ---- Diagnostics spam: proves BoundedLog caps at 100 (ADR-08) ----
export function diagnosticsSpamPlugin(): PluginDefinition {
  return {
    id: 'demo.diagnostics-spam',
    version: '1.0.0',
    setup: (ctx) => {
      for (let i = 0; i < 150; i += 1) {
        ctx.diagnose({ message: `spam-${i}`, details: { index: i }, severity: 'info' });
      }
    },
  };
}

// ---- Disposal stress: LIFO + continue-on-error (INV-02/03) — kept for host recipes ----
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
      (globalThis as unknown as { __disposalOrder?: string[] }).__disposalOrder = order;
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

// ---- Semver versioned provider/consumer for INCOMPATIBLE_CAPABILITY proof ----
export function versionedProviderPlugin(version: string): PluginDefinition {
  return {
    id: 'demo.versioned-provider',
    version,
    provides: [{ capability: versionedCapability }],
    setup: (ctx) => ctx.provide(versionedCapability, { v: Number.parseInt(version, 10) }),
  };
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
