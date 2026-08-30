// Bootstrap verification (ledger P0-A5): proves the rig itself — supported
// runtime, the platform primitives the runtime depends on, and an
// environment free of browser globals. These are environment facts, not
// stubs; they fail loudly if the rig or the engines contract breaks.
describe('P0 toolchain bootstrap (ledger P0-A5)', () => {
  it('runs on a supported node runtime (engines >= 22)', () => {
    const major = Number(process.versions.node.split('.')[0]);
    expect(Number.isFinite(major)).toBe(true);
    expect(major).toBeGreaterThanOrEqual(22);
  });

  it('provides the platform primitives the runtime depends on', () => {
    expect('AbortController' in globalThis).toBe(true);
    expect('EventTarget' in globalThis).toBe(true);
    expect('asyncDispose' in Symbol).toBe(true);
  });

  it('keeps the core environment free of browser globals', () => {
    expect('window' in globalThis).toBe(false);
    expect('document' in globalThis).toBe(false);
  });
});
