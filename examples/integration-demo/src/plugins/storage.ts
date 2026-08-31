import { capability } from '@molt/runtime';

export interface Storage {
  readonly get: (key: string) => string | undefined;
  readonly set: (key: string, value: string) => void;
}

export const storageCapability = capability<Storage>('demo.storage', '1.0.0');

/** Multi-provider capability — each provider publishes string[] that gets concatenated host-first */
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
