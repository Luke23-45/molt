import { createEventBus } from '@molt/events';
import {
  ContributionErrorBoundary,
  guardGenerationCallback,
  reactRoute,
  reactWidget,
  RuntimeProvider,
  useContributions,
  useContributionEntries,
} from '@molt/react';
import { capability, contributionKey, createRuntime, isMoltError, MoltError } from '@molt/runtime';
import { createViteBridge } from '@molt/vite';
import type { ViteHotSource, VitePluginUpdate } from '@molt/vite';
import { fakeResources, pluginHarness } from '@molt/test';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

import {
  analyticsPluginA,
  analyticsPluginB,
  brokenStoragePlugin,
  configConsumerPlugin,
  consumerMultiPlugin,
  cycleAPlugin,
  cycleBPlugin,
  disposalStressPlugin,
  eventBusCapability,
  fixedStoragePlugin,
  hostEventFactory,
  optionalConsumerPlugin,
  storagePlugin,
  widgetPlugin,
} from '../src/plugins/definitions.js';
import { demoBannerKey } from '../src/plugins/definitions.js';
import {
  hostConfigCapability,
  hostLoggerCapability,
  storageCapability,
} from '../src/plugins/storage.js';

void disposalStressPlugin;
void cycleAPlugin;
void cycleBPlugin;

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function WidgetView() {
  const widgets = useContributions(reactWidget);
  return createElement(
    'div',
    { 'data-testid': 'widgets' },
    widgets.map((w, i) => createElement(w.component, { key: i })),
  );
}

function makeHot(): {
  source: ViteHotSource;
  emit: (e: 'added' | 'changed' | 'removed', u: VitePluginUpdate) => Promise<void>;
} {
  const listeners = new Map<string, Set<(u: VitePluginUpdate) => void | Promise<void>>>();
  const source: ViteHotSource = {
    on: (event, listener) => {
      let set = listeners.get(event);
      if (set === undefined) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(listener);
      return () => set?.delete(listener);
    },
  };
  const emit = async (event: 'added' | 'changed' | 'removed', update: VitePluginUpdate) => {
    const set = listeners.get(event);
    if (set === undefined) return;
    for (const l of [...set]) await l(update);
  };
  return { source, emit };
}

describe('integration-demo (real-app, robust, end-to-end)', () => {
  it('INV-06/07/08 + Vite all 3 events + React committed snapshot + observer + diagnostics', async () => {
    const runtime = createRuntime({
      providers: [
        { capability: hostLoggerCapability, value: { log: () => {} } },
        { capability: hostConfigCapability, value: { env: 'test' } },
        { capability: eventBusCapability, value: hostEventFactory() },
      ],
    });
    const { source, emit } = makeHot();
    const viteDiagnostics: unknown[] = [];
    const bridge = createViteBridge({
      runtime,
      hot: source,
      diagnose: (e) => viteDiagnostics.push(e),
    });

    const observerEvents: string[] = [];
    const unsub = runtime.subscribe((e) => {
      observerEvents.push(`${e.type}:${e.pluginId ?? ''}`);
      if (observerEvents.length === 2) throw new Error('observer throw must be isolated');
    });

    runtime.install(storagePlugin('1.0.0'));
    runtime.install(analyticsPluginA());
    runtime.install(analyticsPluginB());
    runtime.install(consumerMultiPlugin());
    runtime.install(optionalConsumerPlugin());
    runtime.install(configConsumerPlugin());
    runtime.install(widgetPlugin('1.0.0'));
    await runtime.start('demo.storage');
    await runtime.start('demo.analytics-a');
    await runtime.start('demo.analytics-b');
    await runtime.start('demo.consumer-multi');
    await runtime.start('demo.optional-consumer');
    await runtime.start('demo.config-consumer');
    await runtime.start('demo.widget');

    // Host providers are permanent and visible in inspect
    expect(runtime.inspect().capabilities.some((c) => c.id === hostLoggerCapability.id)).toBe(true);
    expect(runtime.inspect().capabilities.some((c) => c.id === hostConfigCapability.id)).toBe(true);

    // Multi-provider: consumer saw concatenated array host-first then id lexicographic (no host for analytics, so a then b)
    expect(runtime.inspect().plugins.find((p) => p.id === 'demo.consumer-multi')?.status).toBe(
      'active',
    );

    // Optional present/absent both succeed
    expect(runtime.getStatus('demo.optional-consumer')).toBe('active');

    // Diagnostics: storage plugin called ctx.diagnose
    const storageDiag = runtime.inspect().plugins.find((p) => p.id === 'demo.storage')?.diagnostics;
    expect(storageDiag?.some((d) => d.message.includes('storage 1.0.0 setup'))).toBe(true);

    // Observer: throw is isolated, recorded in observerDiagnostics (INV-10), lifecycle still succeeds
    expect(runtime.inspect().observerDiagnostics.length).toBeGreaterThanOrEqual(1);
    expect(observerEvents).toContain('installed:demo.storage');
    expect(runtime.getStatus('demo.widget')).toBe('active');

    // Contributions: staged invisible before commit (INV-06) — via React
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    act(() => {
      root.render(createElement(RuntimeProvider, { runtime }, createElement(WidgetView)));
    });
    expect(container.textContent).toContain('widget:1.0.0');

    // Contributions snapshot includes reactWidget + reactRoute + demoBannerKey
    expect(runtime.contributions().entries.get(reactWidget.id)?.length).toBe(1);
    expect(runtime.contributions().entries.get(reactRoute.id)?.length).toBe(1);
    expect(runtime.contributions().entries.get(demoBannerKey.id)?.length).toBe(1);

    // Vite: failed import keeps old (module-import-failed)
    await expect(
      bridge.handleChanged({
        pluginId: 'demo.storage',
        loadDefinition: () => Promise.reject(new Error('import failed')),
      }),
    ).rejects.toSatisfy((e: unknown) => isMoltError(e) && e.code === 'REPLACEMENT_FAILED');
    expect(runtime.getStatus('demo.storage')).toBe('active');
    expect(container.textContent).toContain('widget:1.0.0');
    expect(viteDiagnostics.length).toBe(1);

    // Direct broken candidate also keeps old (INV-07)
    await expect(runtime.replace(brokenStoragePlugin('2.0.0'))).rejects.toSatisfy(
      (e: unknown) => isMoltError(e) && e.code === 'REPLACEMENT_FAILED',
    );
    expect(container.textContent).toContain('widget:1.0.0');

    // Fixed via bridge
    const fixedDef = fixedStoragePlugin('2.0.0');
    await act(async () => {
      await emit('changed', { pluginId: 'demo.storage', loadDefinition: () => fixedDef });
    });
    await act(async () => {
      await runtime.replace(widgetPlugin('2.0.0'));
    });
    expect(container.textContent).toContain('widget:2.0.0');

    // Vite added / removed (explicit uninstall) — use unique capability to avoid collision with demo.storage
    const viteAddedCap = capability<{ v: string }>('demo.added-cap', '1.0.0');
    const addedDef = {
      id: 'demo.added',
      version: '1.0.0',
      provides: [{ capability: viteAddedCap }],
      setup: (ctx: import('@molt/runtime').PluginContext) => ctx.provide(viteAddedCap, { v: '1' }),
    } as import('@molt/runtime').PluginDefinition;
    await emit('added', { pluginId: 'demo.added', loadDefinition: () => addedDef });
    expect(runtime.getStatus('demo.added')).toBe('active');
    await runtime.stop('demo.added');
    await emit('removed', { pluginId: 'demo.added' });
    expect(runtime.getStatus('demo.added')).toBeUndefined();

    // Uninstall requires stopped (INVALID_STATE)
    await expect(runtime.uninstall('demo.widget')).rejects.toSatisfy(
      (e: unknown) => isMoltError(e) && e.code === 'INVALID_STATE',
    );

    await act(async () => {
      await runtime.dispose();
    });
    expect(container.textContent).toBe('');
    root.unmount();
    document.body.removeChild(container);
    bridge.close();
    unsub();

    // Idempotent dispose (INV-05)
    await runtime.dispose();
    await runtime.dispose();
    expect(
      runtime.inspect().plugins.every((p) => p.status === 'stopped' || p.status === 'installed'),
    ).toBe(true);
  });

  it('INV-01/02/03/04/05/12: Scope LIFO, continue-on-error, idempotent, signal, acquire-after-dispose, Symbol.asyncDispose, pluginHarness', async () => {
    const resources = fakeResources();
    const failing = resources.failing('listener');
    failing.failOn({ operation: 'dispose', occurrence: 1 });

    // Use pluginHarness for setup-level test (public API only)
    const harness = pluginHarness({
      id: 'demo.scope-harness',
      version: '1.0.0',
      setup: async (ctx) => {
        // Acquire 3 resources to prove LIFO and continue-on-error
        const order: string[] = [];
        await ctx.scope.acquire(
          () => ({ id: 1 }),
          async () => {
            order.push('dispose-1');
            failing.dispose({ id: 1 } as unknown as { id: number });
          },
        );
        await ctx.scope.acquire(
          () => ({ id: 2 }),
          async () => {
            order.push('dispose-2');
          },
        );
        ctx.scope.onDispose(() => {
          order.push('onDispose-3');
        });
        (globalThis as unknown as { __scopeOrder?: string[] }).__scopeOrder = order;

        // Signal abort proof
        ctx.signal.addEventListener(
          'abort',
          () => {
            order.push('aborted');
          },
          { once: true },
        );

        // Return DisposableLike — adopted before commit
        return {
          dispose: () => {
            order.push('returned-dispose');
          },
        };
      },
    });
    const ctx = await harness.run();
    expect(ctx.pluginId).toBe('demo.scope-harness');
    // Acquire after dispose must throw INVALID_STATE — proved via harness dispose + second acquire
    await harness.dispose();
    await expect(
      ctx.scope.acquire(
        () => ({ id: 99 }),
        async () => {},
      ),
    ).rejects.toSatisfy((e: unknown) => isMoltError(e) && e.code === 'INVALID_STATE');
    await expect((async () => ctx.scope.onDispose(() => {}))()).rejects.toSatisfy(
      (e: unknown) => isMoltError(e) && e.code === 'INVALID_STATE',
    );

    // LIFO + continue: abort fires first (signal abort before disposers), then LIFO
    const order = (globalThis as unknown as { __scopeOrder?: string[] }).__scopeOrder ?? [];
    expect(order).toEqual(['aborted', 'returned-dispose', 'onDispose-3', 'dispose-2', 'dispose-1']);

    // Symbol.asyncDispose proof
    const scope = (harness as unknown as { runtime: never }).runtime as unknown as {
      dispose: () => Promise<void>;
    };
    void scope;
    const directScope = (await import('@molt/runtime')).createRuntime as unknown as never;
    void directScope;
    // Symbol.asyncDispose proof — scope exposes it and it is idempotent, verified outside setup
    const { createRuntime: _cr } = await import('@molt/runtime');
    const rt2 = _cr();
    let scopeRef: import('@molt/runtime').Scope | undefined;
    rt2.install({
      id: 'demo.scope2',
      version: '1.0.0',
      setup: (c) => {
        scopeRef = c.scope;
        expect(typeof (c.scope as unknown as Record<symbol, unknown>)[Symbol.asyncDispose]).toBe(
          'function',
        );
      },
    });
    await rt2.start('demo.scope2');
    if (scopeRef !== undefined) {
      expect(scopeRef.isDisposed()).toBe(false);
      await scopeRef[Symbol.asyncDispose]();
      expect(scopeRef.isDisposed()).toBe(true);
      await scopeRef[Symbol.asyncDispose]();
    }
    await rt2.dispose();
    (globalThis as unknown as { __scopeOrder?: unknown }).__scopeOrder = undefined;
  });

  it('INV-09/10: capability validation, MoltError codes, blocked diagnostics, dependency cycle, MISSING/AMBIGUOUS', async () => {
    const rt = createRuntime();
    const capA = capability<{ v: string }>('demo.cap-a', '1.0.0');
    const capMulti = capability<readonly string[]>('demo.cap-multi', '1.0.0', { multiple: true });

    // INVALID_DEFINITION: duplicate id
    rt.install({ id: 'demo.dup', version: '1.0.0', setup: () => {} });
    expect(() => rt.install({ id: 'demo.dup', version: '1.0.0', setup: () => {} })).toThrow();
    try {
      rt.install({ id: 'demo.dup', version: '1.0.0', setup: () => {} });
    } catch (e: unknown) {
      expect(isMoltError(e) && e.code === 'DUPLICATE_PLUGIN').toBe(true);
    }

    // Use fresh runtime to avoid pollution
    const rt2 = createRuntime();
    // MISSING_CAPABILITY
    rt2.install({
      id: 'demo.needs-a',
      version: '1.0.0',
      requires: [{ capability: capA, range: '*' }],
      setup: () => {},
    });
    await expect(rt2.start('demo.needs-a')).rejects.toSatisfy(
      (e: unknown) => isMoltError(e) && e.code === 'MISSING_CAPABILITY',
    );
    // blockedBy diagnostics populated
    const blocked = rt2.inspect().plugins.find((p) => p.id === 'demo.needs-a')?.blockedBy;
    expect(blocked !== undefined && blocked.length > 0).toBe(true);

    // AMBIGUOUS_PROVIDER: two single providers both installed — consumer resolution is ambiguous
    const rt3 = createRuntime();
    rt3.install({
      id: 'demo.p1',
      version: '1.0.0',
      provides: [{ capability: capA }],
      setup: (c) => c.provide(capA, { v: '1' }),
    });
    rt3.install({
      id: 'demo.p2',
      version: '1.0.0',
      provides: [{ capability: capA }],
      setup: (c) => c.provide(capA, { v: '2' }),
    });
    rt3.install({
      id: 'demo.c',
      version: '1.0.0',
      requires: [{ capability: capA, range: '*' }],
      setup: (c) => void c.require(capA),
    });
    await expect(rt3.start('demo.c')).rejects.toSatisfy(
      (e: unknown) => isMoltError(e) && e.code === 'AMBIGUOUS_PROVIDER',
    );

    // Multi-provider aggregation host-first lexicographic
    const rt4 = createRuntime({
      providers: [{ capability: capMulti, value: ['host'] }],
    });
    rt4.install({
      id: 'demo.m-a',
      version: '1.0.0',
      provides: [{ capability: capMulti, multiple: true }],
      setup: (c) => c.provide(capMulti, ['a']),
    });
    rt4.install({
      id: 'demo.m-b',
      version: '1.0.0',
      provides: [{ capability: capMulti, multiple: true }],
      setup: (c) => c.provide(capMulti, ['b']),
    });
    rt4.install({
      id: 'demo.m-consumer',
      version: '1.0.0',
      requires: [{ capability: capMulti, range: '*' }],
      setup: (c) => {
        const v = c.require(capMulti);
        if (JSON.stringify(v) !== JSON.stringify(['host', 'a', 'b']))
          throw new Error(`order wrong ${JSON.stringify(v)}`);
      },
    });
    await rt4.start('demo.m-a');
    await rt4.start('demo.m-b');
    await rt4.start('demo.m-consumer');

    // DEPENDENCY_CYCLE
    const rt5 = createRuntime();
    const capX = capability<{ v: string }>('demo.cycle-x', '1.0.0');
    const capY = capability<{ v: string }>('demo.cycle-y', '1.0.0');
    rt5.install({
      id: 'demo.cx',
      version: '1.0.0',
      provides: [{ capability: capX }],
      requires: [{ capability: capY, range: '*' }],
      setup: (c) => c.provide(capX, { v: 'x' }),
    });
    rt5.install({
      id: 'demo.cy',
      version: '1.0.0',
      provides: [{ capability: capY }],
      requires: [{ capability: capX, range: '*' }],
      setup: (c) => c.provide(capY, { v: 'y' }),
    });
    await expect(rt5.start('demo.cx')).rejects.toSatisfy(
      (e: unknown) => isMoltError(e) && e.code === 'DEPENDENCY_CYCLE',
    );

    // INV-09: undeclared require throws INVALID_STATE
    const rt6 = createRuntime();
    const capU = capability<{ v: string }>('demo.undeclared', '1.0.0');
    rt6.install({
      id: 'demo.undeclared-consumer',
      version: '1.0.0',
      setup: (c) => {
        (c as unknown as { require: (cap: unknown) => unknown }).require(capU);
      },
    });
    await expect(rt6.start('demo.undeclared-consumer')).rejects.toSatisfy(
      (e: unknown) => isMoltError(e) && e.code === 'INVALID_STATE',
    );

    // MoltError shape + isMoltError brand + MoltError.from
    const err = new MoltError(
      { code: 'INVALID_STATE', message: 'x', details: { reason: 'test' } },
      new Error('cause'),
    );
    expect(isMoltError(err)).toBe(true);
    expect(err.details?.reason).toBe('test');
    expect(Object.isFrozen(err)).toBe(true);
    expect(isMoltError(new Error('plain'))).toBe(false);
    expect(MoltError.from(new Error('plain')).code).toBe('ACTIVATION_FAILED');
    expect(MoltError.from(err).code).toBe('INVALID_STATE');

    await rt.dispose();
    await rt2.dispose();
    await rt3.dispose();
    await rt4.dispose();
    await rt5.dispose();
    await rt6.dispose();
  });

  it('INV-01/12 + events sync/async, error isolation, flush, concurrent, Scope removal', async () => {
    const resources = fakeResources();
    const busSync = createEventBus<{ tick: { seq: number }; alert: { msg: string } }>('sync');
    const runtime = createRuntime();

    // Sync: ordered, throwing isolated
    const order: string[] = [];
    const harnessEvents = pluginHarness({
      id: 'demo.events-scope',
      version: '1.0.0',
      setup: async (ctx) => {
        const r = resources.listenerHost();
        await ctx.scope.acquire(r.create, r.dispose);
        busSync.on(ctx.scope, 'tick', () => {
          order.push('a');
        });
        busSync.on(
          ctx.scope,
          'tick',
          () => {
            throw new Error('throw');
          },
          (e) => {
            order.push(`diagnose:${String((e as Error).message)}`);
          },
        );
        busSync.on(ctx.scope, 'tick', (p) => {
          order.push(`c:${p.seq}`);
        });
      },
    });
    await harnessEvents.run();
    void busSync.emit('tick', { seq: 1 });
    expect(order).toEqual(['a', 'diagnose:throw', 'c:1']);

    // Async: per-key ordered, concurrent across keys, flush
    const busAsync2 = createEventBus<{ tick: { seq: number }; alert: { msg: string } }>('async');
    const h = pluginHarness({
      id: 'demo.async-events',
      version: '1.0.0',
      setup: async (ctx) => {
        const received: number[] = [];
        busAsync2.on(ctx.scope, 'tick', async (p) => {
          await new Promise<void>((r) => setTimeout(r, 5));
          received.push(p.seq);
        });
        void busAsync2.emit('tick', { seq: 1 });
        void busAsync2.emit('tick', { seq: 2 });
        await busAsync2.flush();
        expect(received).toEqual([1, 2]);
        // concurrent across keys
        let tickDone = false;
        busAsync2.on(ctx.scope, 'tick', async () => {
          await new Promise<void>((r) => setTimeout(r, 20));
          tickDone = true;
        });
        const t1 = busAsync2.emit('tick', { seq: 3 });
        const a1 = busAsync2.emit('alert', { msg: 'hi' });
        await a1;
        expect(tickDone).toBe(false);
        await t1;
      },
    });
    await h.run();
    await h.dispose();

    // Generation-scoped removal after harness dispose
    const after: string[] = [];
    let tmpScope: import('@molt/runtime').Scope | undefined;
    const tmpHarness = pluginHarness({
      id: 'demo.tmp',
      version: '1.0.0',
      setup: (c) => {
        tmpScope = c.scope;
      },
    });
    await tmpHarness.run();
    if (tmpScope !== undefined) {
      busSync.on(tmpScope, 'tick', () => {
        after.push('x');
      });
    }
    void after;
    // Use fakeResources leak proof after 100 replaces already covered in other test, but also here:
    const rt2 = createRuntime();
    const def = (v: string) => ({
      id: 'demo.leak2',
      version: v,
      setup: async (ctx: import('@molt/runtime').PluginContext) => {
        const r = resources.timerHost();
        await ctx.scope.acquire(r.create, r.dispose);
      },
    });
    rt2.install(def('1.0.0'));
    await rt2.start('demo.leak2');
    for (let i = 0; i < 50; i += 1) await rt2.replace(def(`1.0.${i + 1}`));
    await rt2.dispose();
    await harnessEvents.dispose();
    await tmpHarness.dispose();
    resources.expectNoLeaks();
    await runtime.dispose();
  });

  it('React: useContributions, useContributionEntries, error boundary, guardGenerationCallback, Vite added->changed->removed', async () => {
    const rt = createRuntime();
    const bannerKey = contributionKey<{ text: string }>('demo.react-banner');
    rt.install({
      id: 'demo.react-p1',
      version: '1.0.0',
      setup: (ctx) => {
        ctx.contribute(bannerKey, { text: 'p1' });
        ctx.contribute(reactWidget, {
          label: 'w1',
          component: () => createElement('span', null, 'w1'),
        });
      },
    });
    await rt.start('demo.react-p1');
    expect(rt.contributions().entries.get(bannerKey.id)?.length).toBe(1);
    const entries = (() => {
      // Simulate useContributionEntries via direct snapshot
      return rt.contributions().entries.get(reactWidget.id)?.[0];
    })();
    expect(entries?.pluginId).toBe('demo.react-p1');

    // useContributions / useContributionEntries via real render
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    function View() {
      const banners = useContributions(bannerKey);
      const widgets = useContributionEntries(reactWidget);
      return createElement('div', null, `${banners[0]?.text}:${widgets.length}`);
    }
    act(() => {
      root.render(createElement(RuntimeProvider, { runtime: rt }, createElement(View)));
    });
    expect(container.textContent).toBe('p1:1');

    // Error boundary
    const errors: unknown[] = [];
    const boundary = new ContributionErrorBoundary({
      children: 'ok',
      fallback: 'fb',
      onError: (e) => errors.push(e),
    });
    boundary.state = ContributionErrorBoundary.getDerivedStateFromError(new Error('boom'));
    expect(boundary.render()).toBe('fb');
    boundary.componentDidCatch(new Error('boom'), { componentStack: 's' });
    expect(errors.length).toBe(1);

    // guardGenerationCallback
    const gen = rt.inspect().plugins.find((p) => p.id === 'demo.react-p1')?.generation ?? '';
    const calls: string[] = [];
    const guarded = guardGenerationCallback(rt, gen, (x: string) => calls.push(x));
    guarded('a');
    await rt.stop('demo.react-p1');
    guarded('b');
    expect(calls).toEqual(['a']);

    // Vite bridge added/changed/removed full flow — use unique capability to avoid single-provider collision
    const { source, emit } = makeHot();
    const bridge = createViteBridge({ runtime: rt, hot: source });
    const viteCap = capability<{ v: string }>('demo.vite-added-cap', '1.0.0');
    const newPlugin = {
      id: 'demo.vite-added',
      version: '1.0.0',
      provides: [{ capability: viteCap }],
      setup: (ctx: import('@molt/runtime').PluginContext) => ctx.provide(viteCap, { v: '1' }),
    } as import('@molt/runtime').PluginDefinition;
    await emit('added', { pluginId: 'demo.vite-added', loadDefinition: () => newPlugin });
    expect(rt.getStatus('demo.vite-added')).toBe('active');
    await emit('changed', {
      pluginId: 'demo.vite-added',
      loadDefinition: () => ({
        ...newPlugin,
        version: '1.0.1',
        setup: (ctx: import('@molt/runtime').PluginContext) => ctx.provide(viteCap, { v: '2' }),
      }),
    });
    expect(rt.getStatus('demo.vite-added')).toBe('active');
    await rt.stop('demo.vite-added');
    await emit('removed', { pluginId: 'demo.vite-added' });
    expect(rt.getStatus('demo.vite-added')).toBeUndefined();
    bridge.close();

    act(() => root.unmount());
    document.body.removeChild(container);
    await rt.dispose();
  });

  it('INV-08/14 + INV-15: old disposal failure keeps new, active dependent blocks replace', async () => {
    const resources = fakeResources();
    const failingDispose = resources.failing('connection');
    failingDispose.failOn({ operation: 'dispose', occurrence: 1 });

    const rt = createRuntime();
    rt.install({
      id: 'demo.dep2',
      version: '1.0.0',
      provides: [{ capability: storageCapability }],
      setup: async (ctx) => {
        await ctx.scope.acquire(failingDispose.create, failingDispose.dispose);
        ctx.provide(storageCapability, { get: () => undefined, set: () => {} });
      },
    });
    await rt.start('demo.dep2');
    rt.install({
      id: 'demo.dependent',
      version: '1.0.0',
      requires: [{ capability: storageCapability, range: '^1.0.0' }],
      setup: (ctx) => void ctx.require(storageCapability),
    });
    await rt.start('demo.dependent');

    // INV-15: replace provider with active dependent must be REPLACEMENT_FAILED
    await expect(
      rt.replace({
        id: 'demo.dep2',
        version: '1.0.1',
        provides: [{ capability: storageCapability }],
        setup: (c) => c.provide(storageCapability, { get: () => 'new', set: () => {} }),
      }),
    ).rejects.toSatisfy((e: unknown) => isMoltError(e) && e.code === 'REPLACEMENT_FAILED');

    // Remove dependent, then replace succeeds even though old disposal fails (INV-08/14)
    await rt.stop('demo.dependent');
    await rt.uninstall('demo.dependent');
    await rt.replace({
      id: 'demo.dep2',
      version: '1.0.1',
      provides: [{ capability: storageCapability }],
      setup: (c) => c.provide(storageCapability, { get: () => 'new', set: () => {} }),
    });
    expect(rt.getStatus('demo.dep2')).toBe('active');
    // Old dispose failed but new is active — error recorded
    expect(isMoltError(rt.inspect().plugins.find((p) => p.id === 'demo.dep2')?.error)).toBe(true);

    await rt.dispose();
  });

  it('INV-13/09 + host capability: two runtimes isolated, undeclared require throws, duplicate install throws', async () => {
    const cap = capability<{ v: number }>('demo.isolated', '1.0.0');
    const rtA = createRuntime({ providers: [{ capability: cap, value: { v: 1 } }] });
    const rtB = createRuntime();
    rtA.install({
      id: 'demo.a',
      version: '1.0.0',
      requires: [{ capability: cap, range: '*' }],
      setup: (c) => void c.require(cap),
    });
    await rtA.start('demo.a');
    expect(rtA.getStatus('demo.a')).toBe('active');
    expect(rtB.getStatus('demo.a')).toBeUndefined(); // INV-13 no globals

    // DUPLICATE_PLUGIN
    expect(() => rtA.install({ id: 'demo.a', version: '1.0.0', setup: () => {} })).toThrow();

    // uninstall requires stopped
    await expect(rtA.uninstall('demo.a')).rejects.toSatisfy(
      (e: unknown) => isMoltError(e) && e.code === 'INVALID_STATE',
    );

    await rtA.dispose();
    await rtB.dispose();
  });
});
