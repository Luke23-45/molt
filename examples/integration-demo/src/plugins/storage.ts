import { capability } from '@molt/runtime';

export interface Storage {
  readonly get: (key: string) => string | undefined;
  readonly set: (key: string, value: string) => void;
}

export const storageCapability = capability<Storage>('demo.storage', '1.0.0');

/** Multi-provider capability — each provider publishes string[] that gets concatenated host-first INV-11 ordering */
export const analyticsCapability = capability<readonly string[]>('demo.analytics', '1.0.0', {
  multiple: true,
});

export const optionalLoggerCapability = capability<{ log: (m: string) => void }>(
  'demo.logger',
  '1.0.0',
);

export const hostLoggerCapability = capability<{ log: (m: string) => void }>(
  'host.logger',
  '1.0.0',
);

export const hostConfigCapability = capability<{ env: string }>('host.config', '1.0.0');

/** Versioned contract for INCOMPATIBLE_CAPABILITY proof — provider v2, consumer requires ^1.0.0 must fail */
export const versionedCapability = capability<{ v: number }>('demo.versioned', '2.0.0');

/** Strict 1.0.0 variant of same id for semver pairing */
export const versionedCapabilityV1 = capability<{ v: number }>('demo.versioned', '1.0.0');

/** Cascade dependency token — cascadeRoot -> cascadeDependent */
export const cascadeRootCapability = capability<{ id: string }>('demo.cascade-root', '1.0.0');

/** Notification capability provided by host-owned factory consumer */
export const notificationCapability = capability<{ notify: (msg: string) => void }>(
  'demo.notifications',
  '1.0.0',
);
