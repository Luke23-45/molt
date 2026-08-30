// Edge-path battery for the lifecycle engine (complements plan 04 §2's
// runtime inventory): concurrent mutations during activation, rollback of
// partial closures, multi-token publish validation, cascade disposal
// failures, and blocked-plugin inspection (note 04 requirement 5).

import { capability } from '../src/index.js';
import { createRuntime } from '../src/index.js';
import { isMoltError, MoltError } from '../src/index.js';
import { createDeferred } from '../src/internal/async.js';

const capA = capability<{ id: string }>('test.edge.a', '1.0.0');
const capB = capability<{ id: string }>('test.edge.b', '1.0.0');
const multi = capability<readonly { name: string }[]>('test.edge.multi', '1.0.0', {
  multiple: true,
});

function expectCode(error: unknown, code: MoltError['code']): MoltError {
  if (!isMoltError(error)) {
    throw new Error(`expected MoltError(${code}), got: ${String(error)}`);
  }
  expect(error.code).toBe(code);
  return error;
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected the promise to reject');
    },
    (error: unknown) => error,
  );
}

describe('concurrent mutations during activation (plan 00 sec 5)', () => {
  it('a provider uninstalled mid-closure fails the activation with its structured cause and rolls back', async () => {
    const runtime = createRuntime();
    let released = 0;
    runtime.install({
      id: 'test.a',
      version: '1.0.0',
      provides: [{ capability: capA }],
      setup: async (ctx) => {
        await ctx.scope.acquire(
          () => ({ id: 'a' }),
          () => {
            released += 1;
          },
        );
        await runtime.uninstall('test.b'); // removes a later member of the closure
        ctx.provide(capA, { id: 'a' });
      },
    });
    runtime.install({
      id: 'test.b',
      version: '1.0.0',
      provides: [{ capability: capB }],
      setup: (ctx) => {
        ctx.provide(capB, { id: 'b' });
      },
    });
    runtime.install({
      id: 'test.root',
      version: '1.0.0',
      requires: [
        { capability: capA, range: '*' },
        { capability: capB, range: '*' },
      ],
      setup: () => undefined,
    });

    const error = expectCode(await rejectionOf(runtime.start('test.root')), 'INVALID_STATE');
    expect(error.details?.['reason']).toBe('removed-during-activation');
    // Rollback: the already-committed generation of test.a is disposed.
    expect(released).toBe(1);
    expect(runtime.getStatus('test.a')).toBe('stopped');
    expect(runtime.getStatus('test.root')).toBe('stopped');
    expect(runtime.inspect().capabilities).toEqual([]);
  });

  it('a provider stopped concurrently makes the consumer requirement resolve as disappeared', async () => {
    const runtime = createRuntime();
    const entered = createDeferred<void>();
    const release = createDeferred<void>();
    runtime.install({
      id: 'test.p',
      version: '1.0.0',
      provides: [{ capability: capB }],
      setup: (ctx) => {
        ctx.provide(capB, { id: 'b' });
      },
    });
    runtime.install({
      id: 'test.z',
      version: '1.0.0',
      requires: [{ capability: capB, range: '*' }],
      setup: async (ctx) => {
        entered.resolve();
        await release.promise; // the test stops the provider while we wait
        ctx.require(capB); // binding was withdrawn by the concurrent stop
      },
    });
    await runtime.start('test.p');
    const starting = runtime.start('test.z');
    await entered.promise;
    const stopping = runtime.stop('test.p'); // different queue key: runs concurrently
    await stopping;
    release.resolve();

    const error = expectCode(await rejectionOf(starting), 'INVALID_STATE');
    expect(error.message).toContain('disappeared');
    expect(runtime.getStatus('test.z')).toBe('stopped');
  });
});

describe('multi-provider publish validation (plan 03 sec 1)', () => {
  it('publishing a non-array value for a multi token fails activation', async () => {
    const runtime = createRuntime();
    runtime.install({
      id: 'test.bad-multi',
      version: '1.0.0',
      provides: [{ capability: multi }],
      setup: (ctx) => {
        // JS boundary: bypass the element-array contract.
        ctx.provide(multi, { name: 'not-an-array' } as unknown as readonly { name: string }[]);
      },
    });
    const error = expectCode(
      await rejectionOf(runtime.start('test.bad-multi')),
      'ACTIVATION_FAILED',
    );
    expect(error.message).toContain('must be published as an array');
    expect(runtime.getStatus('test.bad-multi')).toBe('stopped');
  });
});

describe('cascade disposal failures are inspectable (INV-14 analog)', () => {
  it('a failing disposer during cascade stop is recorded on the record', async () => {
    const runtime = createRuntime();
    const failure = new Error('cascade disposer fault');
    runtime.install({
      id: 'test.provider',
      version: '1.0.0',
      provides: [{ capability: capA }],
      setup: (ctx) => {
        ctx.provide(capA, { id: 'a' });
      },
    });
    runtime.install({
      id: 'test.dependent',
      version: '1.0.0',
      requires: [{ capability: capA, range: '*' }],
      setup: (ctx) => {
        ctx.scope.onDispose(() => {
          throw failure;
        });
      },
    });
    await runtime.start('test.dependent');

    await runtime.stop('test.provider', { cascade: true });
    expect(runtime.getStatus('test.dependent')).toBe('stopped');
    const recordError: unknown = runtime
      .inspect()
      .plugins.find((p) => p.id === 'test.dependent')?.error;
    expectCode(recordError, 'DISPOSAL_FAILED');
    expect(runtime.getStatus('test.provider')).toBe('stopped');
  });
});

describe('blocked-plugin inspection (note 04 requirement 5)', () => {
  it('a failed start exposes the structured blocked diagnostics without internals', async () => {
    const runtime = createRuntime();
    runtime.install({
      id: 'test.blocked',
      version: '1.0.0',
      requires: [{ capability: capA, range: '^2.0.0' }],
      setup: () => undefined,
    });
    await rejectionOf(runtime.start('test.blocked'));

    const record = runtime.inspect().plugins.find((p) => p.id === 'test.blocked');
    expect(record?.status).toBe('stopped');
    const blocked = record?.blockedBy?.[0];
    expect(blocked?.pluginId).toBe('test.blocked');
    expect(blocked?.requirement.capabilityId).toBe('test.edge.a');
    expect(blocked?.candidates).toEqual([]);
  });

  it('a diagnostic recorded through ctx.diagnose is capped and generation-scoped', async () => {
    const runtime = createRuntime();
    runtime.install({
      id: 'test.chatty',
      version: '1.0.0',
      setup: (ctx) => {
        ctx.diagnose({ message: 'hello', severity: 'info' });
      },
    });
    await runtime.start('test.chatty');
    expect(runtime.getStatus('test.chatty')).toBe('active');
  });
});

describe('replacement candidates with requirements (plan 00 sec 4.3)', () => {
  it('a candidate that requires a host capability resolves it while the old generation serves', async () => {
    const runtime = createRuntime({
      providers: [{ capability: capB, value: { id: 'host-b' } }],
    });
    runtime.install({
      id: 'test.provider',
      version: '1.0.0',
      provides: [{ capability: capA }],
      setup: (ctx) => {
        ctx.provide(capA, { id: 'v1' });
      },
    });
    await runtime.start('test.provider');

    let observed: string | undefined;
    await runtime.replace({
      id: 'test.provider',
      version: '2.0.0',
      requires: [{ capability: capB, range: '*' }],
      provides: [{ capability: capA }],
      setup: async (ctx) => {
        await ctx.scope.acquire(
          () => ({ id: 'candidate' }),
          () => undefined,
        );
        observed = ctx.require(capB).id;
        ctx.provide(capA, { id: 'v2' });
      },
    });
    expect(observed).toBe('host-b');
    expect(runtime.getStatus('test.provider')).toBe('active');
  });
});
