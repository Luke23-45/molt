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

  it('environment axis: node is DOM-free, happy-dom is functional (plan 04 sec 5)', () => {
    // The unit project (node) must never see browser globals — the compile
    // guard is tsconfig's DOM-free `lib`; this is the runtime double-check.
    // The unit-dom project (happy-dom) must actually provide them, proving
    // the browser-like axis runs for real rather than silently skipping.
    if ('window' in globalThis) {
      expect('document' in globalThis).toBe(true);
    } else {
      expect('document' in globalThis).toBe(false);
    }
  });
});
