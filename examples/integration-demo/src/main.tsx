/**
 * Real-app host: Vite + React wiring every Molt public export.
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
import { createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import type { DemoEvents } from './plugins/definitions.js';
import {
  analyticsPluginA,
  analyticsPluginB,
  configConsumerPlugin,
  consumerMultiPlugin,
  eventBusCapability,
  hostEventFactory,
  optionalConsumerPlugin,
  storagePlugin,
  widgetPlugin,
} from './plugins/definitions.js';
import {
  hostConfigCapability,
  hostLoggerCapability,
  storageCapability,
} from './plugins/storage.js';

// --- Runtime with host providers (host.logger, host.config, event bus factory) ---
const runtime = createRuntime({
  providers: [
    { capability: hostLoggerCapability, value: { log: (m: string) => console.log('[host]', m) } },
    { capability: hostConfigCapability, value: { env: 'production' } },
    { capability: eventBusCapability, value: hostEventFactory() },
  ],
});

// Direct bus for ad-hoc host events (not a capability)
export const demoBus = createEventBus<DemoEvents>('sync');

// Observer — records lifecycle events + survives throws (observerDiagnostics INV-10)
const observerLog: string[] = [];
const unsubscribe = runtime.subscribe((event) => {
  observerLog.push(`${event.type}:${event.pluginId ?? ''}:${event.generation ?? ''}`);
  if (event.type === 'started' && event.pluginId === 'demo.widget') {
    // Prove observer throw is isolated and recorded in inspect().observerDiagnostics
    // Only once to avoid spam
    if (observerLog.length === 3) throw new Error('observer explode');
  }
});

// --- Vite HMR bridge (all 3 events: added/changed/removed) ---
type Hot = {
  on: (e: string, cb: (m: unknown) => void) => void;
  off: (e: string, cb: (m: unknown) => void) => void;
};
const viteHot = (import.meta as unknown as { hot?: Hot }).hot;
const hotSource: ViteHotSource = {
  on: (event, listener) => {
    if (viteHot === undefined) return () => undefined;
    const viteEvent = event === 'changed' ? 'vite:beforeUpdate' : event;
    const wrapped = (payload: unknown) => void listener(payload as VitePluginUpdate);
    viteHot.on(viteEvent, wrapped);
    return () => viteHot.off(viteEvent, wrapped);
  },
};

export const bridge = createViteBridge({
  runtime,
  hot: hotSource,
  diagnose: (err) => console.error('[vite diagnose]', err.code, err.pluginId, err.cause),
});

// --- Install + start initial graph ---
runtime.install(storagePlugin('1.0.0'));
runtime.install(analyticsPluginA());
runtime.install(analyticsPluginB());
runtime.install(consumerMultiPlugin());
runtime.install(optionalConsumerPlugin());
runtime.install(configConsumerPlugin());
runtime.install(widgetPlugin('1.0.0'));

void (async () => {
  await runtime.start('demo.storage');
  await runtime.start('demo.analytics-a');
  await runtime.start('demo.analytics-b');
  await runtime.start('demo.consumer-multi');
  await runtime.start('demo.optional-consumer');
  await runtime.start('demo.config-consumer');
  await runtime.start('demo.widget');
  // Prove contributions() only shows committed, not staged
  console.log('[contributions]', runtime.contributions().entries.get('demo.banner'));
  console.log(
    '[inspect blockedBy]',
    runtime.inspect().plugins.map((p) => [p.id, p.blockedBy]),
  );
  console.log('[observerDiagnostics]', runtime.inspect().observerDiagnostics);
})();

// --- React shell using every React export ---
function WidgetList() {
  const widgets = useContributions(reactWidget);
  const entries = useContributionEntries(reactWidget);
  return createElement(
    'div',
    { 'data-testid': 'widgets' },
    `entries:${entries.length} `,
    widgets.map((w, i) =>
      createElement(
        ContributionErrorBoundary,
        {
          key: i,
          fallback: createElement('span', null, 'fallback'),
          onError: (e) => console.error('[boundary]', e),
        },
        createElement(w.component),
      ),
    ),
  );
}

function RouteList() {
  const routes = useContributions(reactRoute);
  return createElement('div', { 'data-testid': 'routes' }, routes.map((r) => r.path).join(','));
}

function App() {
  const storageProvider =
    runtime.inspect().capabilities.find((c) => c.id === storageCapability.id)?.provider ??
    'unknown';
  const widgetEntries = useContributionEntries(reactWidget);
  const firstGen = widgetEntries[0]?.generationId ?? '';
  const onClick = guardGenerationCallback(
    runtime,
    firstGen,
    () => console.log('click ok'),
    () => console.warn('stale generation click ignored'),
  );
  return createElement(
    'div',
    null,
    createElement('h1', null, `Molt demo — storage: ${storageProvider}`),
    createElement('button', { onClick: () => onClick?.() }, 'guarded click'),
    createElement(WidgetList),
    createElement(RouteList),
    createElement('pre', null, observerLog.join('\n')),
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

export { observerLog, runtime, unsubscribe };
