/**
 * Real-app host: Vite + React wiring every Molt public export.
 * This is not a toy — it mirrors a production host: typed capabilities, host
 * providers (host.logger/config + event bus factory), generation-scoped React
 * contributions, HMR bridge (added/changed/removed + diagnose), observer bus
 * with isolation, cascade dependency demo, diagnostics viewer, guardGenerationCallback.
 * Reference for `test/integration.test.tsx` end-to-end suite.
 */
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
import { createRuntime } from '@molt/runtime';
import { createViteBridge } from '@molt/vite';
import type { ViteHotSource, VitePluginUpdate } from '@molt/vite';
import { createElement, StrictMode, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';

import type { DemoEvents } from './plugins/definitions.js';
import {
  analyticsPluginA,
  analyticsPluginB,
  cascadeDependentPlugin,
  cascadeRootPlugin,
  configConsumerPlugin,
  consumerMultiPlugin,
  dashboardPlugin,
  demoBannerKey,
  demoToastKey,
  eventBusCapability,
  hostEventFactory,
  notificationConsumerPlugin,
  optionalConsumerPlugin,
  storagePlugin,
  widgetPlugin,
} from './plugins/definitions.js';
import {
  cascadeRootCapability,
  hostConfigCapability,
  hostLoggerCapability,
  notificationCapability,
  storageCapability,
} from './plugins/storage.js';

// --- Runtime with host providers (host.logger, host.config, event bus factory) ---
// INV-13: runtimes share nothing — this instance owns its providers/bus
export const runtime = createRuntime({
  providers: [
    { capability: hostLoggerCapability, value: { log: (m: string) => console.log('[host]', m) } },
    { capability: hostConfigCapability, value: { env: 'production' } },
    // Host-owned multi? no — eventBusFactory is single-provider host factory INV-11
    { capability: eventBusCapability, value: hostEventFactory() },
  ],
});

// Direct bus for ad-hoc host events (not a capability, also exercised via factory)
export const demoBus = createEventBus<DemoEvents>('sync');

// Observer — records lifecycle events + survives throws (observerDiagnostics INV-10)
// Host registers two observers to prove multi-observer + unsubscribe isolation
export const observerLog: string[] = [];
export const observerDiagnosticsLog: string[] = [];
export const unsubscribePrimary = runtime.subscribe((event) => {
  observerLog.push(`${event.type}:${event.pluginId ?? ''}:${event.generation ?? ''}`);
  if (event.type === 'started' && event.pluginId === 'demo.widget') {
    // Prove observer throw is isolated and recorded in inspect().observerDiagnostics
    // Only once to avoid spam, also exercises that second observer still runs after first throws
    if (observerLog.filter((l) => l.startsWith('started:demo.widget')).length === 1) {
      throw new Error('observer explode');
    }
  }
});
export const unsubscribeSecondary = runtime.subscribe((event) => {
  if (event.type === 'failed' || event.type === 'stopped' || event.type === 'replaced') {
    observerDiagnosticsLog.push(`${event.type}:${event.pluginId ?? ''}`);
  }
});

// --- Vite HMR bridge (all 3 events: added/changed/removed + diagnose) ---
// INV-06/07/08 + plan 00 T-R1..R9: HMR delegates entirely to runtime.replace/install
type Hot = {
  on: (e: string, cb: (m: unknown) => void) => void;
  off: (e: string, cb: (m: unknown) => void) => void;
};
const viteHot = (import.meta as unknown as { hot?: Hot }).hot;
const hotSource: ViteHotSource = {
  on: (event, listener) => {
    if (viteHot === undefined) return () => undefined;
    // Molt bridge normalizes to added/changed/removed; Vite's event names differ
    const viteEvent = event === 'changed' ? 'vite:beforeUpdate' : event;
    const wrapped = (payload: unknown) => void listener(payload as VitePluginUpdate);
    viteHot.on(viteEvent, wrapped);
    return () => viteHot.off(viteEvent, wrapped);
  },
};

export const viteDiagnostics: unknown[] = [];
export const bridge = createViteBridge({
  runtime,
  hot: hotSource,
  diagnose: (err) => {
    viteDiagnostics.push(err);
    // eslint-disable-next-line no-console
    console.error('[vite diagnose]', err.code, err.pluginId, err.cause);
  },
});

// --- Install phase: host installs full graph prior to start (real host defers start until deps ready) ---
// Install order does not matter — resolver topologically sorts at start INV-11
runtime.install(storagePlugin('1.0.0'));
runtime.install(analyticsPluginA());
runtime.install(analyticsPluginB());
runtime.install(consumerMultiPlugin());
runtime.install(optionalConsumerPlugin());
runtime.install(configConsumerPlugin());
runtime.install(widgetPlugin('1.0.0'));
runtime.install(cascadeRootPlugin());
runtime.install(cascadeDependentPlugin());
runtime.install(dashboardPlugin());
runtime.install(notificationConsumerPlugin());

// --- Activation: sequential start proves per-plugin queue never deadlocks (ADR-04) ---
void (async () => {
  await runtime.start('demo.storage');
  await runtime.start('demo.analytics-a');
  await runtime.start('demo.analytics-b');
  await runtime.start('demo.consumer-multi');
  await runtime.start('demo.optional-consumer');
  await runtime.start('demo.config-consumer');
  await runtime.start('demo.cascade-root');
  await runtime.start('demo.cascade-dependent');
  await runtime.start('demo.widget');
  await runtime.start('demo.dashboard');
  await runtime.start('demo.notification-consumer');
  // Prove contributions() only shows committed, not staged INV-06
  // eslint-disable-next-line no-console
  console.log('[contributions banner]', runtime.contributions().entries.get(demoBannerKey.id));
  // eslint-disable-next-line no-console
  console.log('[contributions toast]', runtime.contributions().entries.get(demoToastKey.id));
  // eslint-disable-next-line no-console
  console.log(
    '[inspect blockedBy]',
    runtime.inspect().plugins.map((p) => [p.id, p.blockedBy]),
  );
  // eslint-disable-next-line no-console
  console.log('[observerDiagnostics]', runtime.inspect().observerDiagnostics);
  // eslint-disable-next-line no-console
  console.log('[capabilities]', runtime.inspect().capabilities);
})();

// --- Helpers used by React shell that exercise public APIs ---
function useRuntimeSnapshot() {
  // Thin wrapper around useSyncExternalStore + subscribe to prove store semantics without React adapter
  const subscribe = (cb: () => void) => runtime.subscribe(() => cb());
  const getSnapshot = () => runtime.inspect();
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// --- React shell using every React export including error boundary isolation per-slot ---
function WidgetList() {
  const widgets = useContributions(reactWidget);
  const entries = useContributionEntries(reactWidget);
  const banner = useContributions(demoBannerKey);
  void banner;
  return createElement(
    'div',
    { 'data-testid': 'widgets' },
    `entries:${entries.length} `,
    widgets.map((w, i) =>
      createElement(
        ContributionErrorBoundary,
        {
          key: entries[i]?.generationId ?? String(i),
          fallback: createElement('span', { 'data-testid': `widget-fallback-${i}` }, 'fallback'),
          onError: (e) => {
            // eslint-disable-next-line no-console
            console.error('[boundary widget]', e);
            observerDiagnosticsLog.push(`boundary:${String((e as Error).message)}`);
          },
        },
        createElement(w.component),
      ),
    ),
  );
}

function RouteList() {
  const routes = useContributions(reactRoute);
  const toasts = useContributions(demoToastKey);
  return createElement(
    'div',
    { 'data-testid': 'routes' },
    routes.map((r) => r.path).join(','),
    toasts.length > 0
      ? createElement('span', { 'data-testid': 'toast' }, toasts[0]?.message)
      : null,
  );
}

function DiagnosticsPanel() {
  const snap = useRuntimeSnapshot();
  const spam = snap.plugins.find((p) => p.id === 'demo.diagnostics-spam')?.diagnostics;
  return createElement(
    'details',
    { 'data-testid': 'diagnostics' },
    createElement('summary', null, `diagnostics ${snap.plugins.length} plugins`),
    spam !== undefined ? createElement('span', null, `spam:${String(spam.length)}`) : null,
    createElement(
      'ul',
      null,
      snap.plugins.map((p) =>
        createElement('li', { key: p.id }, `${p.id}:${p.status}:${p.generation ?? '-'}`),
      ),
    ),
    createElement(
      'ul',
      { 'data-testid': 'capabilities-list' },
      snap.capabilities.map((c) =>
        createElement(
          'li',
          { key: `${c.id}:${c.provider}` },
          `${c.id}@${c.version} via ${c.provider}`,
        ),
      ),
    ),
  );
}

function App() {
  const storageProvider =
    runtime.inspect().capabilities.find((c) => c.id === storageCapability.id)?.provider ??
    'unknown';
  const widgetEntries = useContributionEntries(reactWidget);
  const notifEntries = useContributionEntries(reactWidget);
  void notifEntries;
  const firstGen = widgetEntries[0]?.generationId ?? '';
  // guardGenerationCallback — stale callback becomes no-op after replace/dispose INV-08, exercise onStale
  const onStaleLog: string[] = [];
  const onClick = guardGenerationCallback(
    runtime,
    firstGen,
    () => {
      // eslint-disable-next-line no-console
      console.log('click ok');
      return 'ok';
    },
    () => {
      // eslint-disable-next-line no-console
      console.warn('stale generation click ignored');
      onStaleLog.push('stale');
      observerDiagnosticsLog.push('stale');
    },
  );
  // Also demonstrate notification capability via guarded callback
  const notifGen =
    runtime.inspect().plugins.find((p) => p.id === 'demo.dashboard')?.generation ?? '';
  const guardedNotify = guardGenerationCallback(
    runtime,
    notifGen,
    (msg: string) => {
      const svc = runtime.inspect().capabilities.find((c) => c.id === notificationCapability.id);
      void svc;
      return msg;
    },
    () => observerDiagnosticsLog.push('notify-stale'),
  );
  void guardedNotify;

  return createElement(
    'div',
    null,
    createElement(
      'h1',
      null,
      `Molt demo — storage: ${storageProvider} cascade: ${cascadeRootCapability.id}`,
    ),
    createElement(
      'button',
      { onClick: () => onClick?.(), 'data-testid': 'guarded-btn' },
      'guarded click',
    ),
    createElement(WidgetList),
    createElement(RouteList),
    createElement(DiagnosticsPanel),
    createElement('pre', { 'data-testid': 'observer-log' }, observerLog.join('\n')),
  );
}

const rootEl = document.getElementById('root');
if (rootEl !== null) {
  createRoot(rootEl).render(
    createElement(
      StrictMode,
      null,
      createElement(RuntimeProvider, { runtime }, createElement(App)),
    ),
  );
}

// Host-level cascade API — real host exposes "stop provider + dependents" via cascade:true
export async function stopCascadeRoot(): Promise<void> {
  await runtime.stop('demo.cascade-root', { cascade: true });
}
