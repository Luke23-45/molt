// MoltError model tests (plan 03 §3): deterministic messages, cause chains,
// the brand-based cross-realm guard, and frozen structured fields.

import vm from 'node:vm';

import { isMoltError, MoltError } from '../src/errors.js';

describe('message format', () => {
  it('is deterministic: "[CODE] summary (context)"', () => {
    const error = new MoltError({
      code: 'MISSING_CAPABILITY',
      message: 'no usable provider',
      pluginId: 'a.b',
      capabilityId: 'c.d',
    });
    expect(error.message).toBe(
      '[MISSING_CAPABILITY] no usable provider (pluginId: a.b, capabilityId: c.d)',
    );
    expect(error.name).toBe('MoltError');
  });

  it('omits the context suffix when no fields are present', () => {
    const error = new MoltError({ code: 'INVALID_STATE', message: 'bad state' });
    expect(error.message).toBe('[INVALID_STATE] bad state');
  });

  it('includes generation between pluginId and capabilityId when present', () => {
    const error = new MoltError({
      code: 'ACTIVATION_FAILED',
      message: 'setup failed',
      pluginId: 'p',
      generation: 'p#1',
    });
    expect(error.message).toBe('[ACTIVATION_FAILED] setup failed (pluginId: p, generation: p#1)');
  });
});

describe('cause chaining', () => {
  it('preserves the cause through the constructor', () => {
    const original = new Error('root cause');
    const error = new MoltError({ code: 'ACTIVATION_FAILED', message: 'setup failed' }, original);
    expect(error.cause).toBe(original);
  });

  it('MoltError.from wraps a foreign Error with the cause intact', () => {
    const original = new Error('foreign');
    const error = MoltError.from(original, 'REPLACEMENT_FAILED');
    expect(isMoltError(error)).toBe(true);
    expect(error.code).toBe('REPLACEMENT_FAILED');
    expect(error.cause).toBe(original);
    expect(error.message).toContain('foreign');
  });

  it('MoltError.from returns MoltError values unchanged (no double wrapping)', () => {
    const existing = new MoltError({ code: 'DISPOSAL_FAILED', message: 'already structured' });
    expect(MoltError.from(existing, 'ACTIVATION_FAILED')).toBe(existing);
  });

  it('MoltError.from(undefined) yields ACTIVATION_FAILED with details.reason (plan 03 §3)', () => {
    const error = MoltError.from(undefined);
    expect(error.code).toBe('ACTIVATION_FAILED');
    expect(error.details?.['reason']).toBe('undefined thrown');
  });

  it('MoltError.from wraps non-Error throwables as the cause', () => {
    const error = MoltError.from('a string thrown', 'ACTIVATION_FAILED');
    expect(error.message).toContain('a string thrown');
    expect(error.cause).toBe('a string thrown');
  });
});

describe('isMoltError', () => {
  it('classifies brand-carrying errors, not instanceof', () => {
    const error = new MoltError({ code: 'INVALID_STATE', message: 'x' });
    expect(isMoltError(error)).toBe(true);
    expect(isMoltError(new Error('plain'))).toBe(false);
    expect(isMoltError('nope')).toBe(false);
    expect(isMoltError(undefined)).toBe(false);
  });

  it('classifies errors from another realm via the registered brand (plan 03 §3)', () => {
    // vm.runInNewContext returns any by design; the snippet is ours — validated boundary.
    const foreign = vm.runInNewContext('new Error("from another realm")', {
      Error,
      Symbol,
    }) as Error;
    Object.defineProperty(foreign, Symbol.for('molt.error.brand'), { value: true });
    expect(isMoltError(foreign)).toBe(true);
  });
});

describe('structured fields are frozen', () => {
  it('details are shallow-frozen — mutation is rejected', () => {
    const error = new MoltError({
      code: 'INVALID_STATE',
      message: 'x',
      details: { reason: 'why' },
    });
    expect(() => {
      (error.details as Record<string, unknown>)['reason'] = 'tampered';
    }).toThrow(TypeError);
    expect(error.details?.['reason']).toBe('why');
  });

  it('path is copied — mutating the original array cannot change the error', () => {
    const path = ['a', 'b'];
    const error = new MoltError({ code: 'DEPENDENCY_CYCLE', message: 'cycle', path });
    path.push('c');
    expect(error.path).toEqual(['a', 'b']);
  });
});
