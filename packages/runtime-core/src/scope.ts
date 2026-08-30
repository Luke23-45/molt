// Ownership scopes and the disposal engine (plan 03 §4, 00 §4.5). The
// invariants live here: LIFO disposal (INV-02), continue-on-error with
// collected failures (INV-03), commit-at-most-once (INV-04), idempotent
// disposal (INV-05), and no resource left owned by a dead scope (INV-01/12).

import type { DisposalReport } from './errors.js';
import { MoltError } from './errors.js';
import { idempotent } from './internal/async.js';

/**
 * The ownership scope every generation runs inside (plan 03 §4): disposal
 * runs LIFO (INV-02), continues after an individual disposer fails with all
 * failures collected (INV-03), and commits at most once (INV-04). A resource
 * whose `create` settles after abort is disposed immediately and `acquire`
 * rejects — nothing stays owned by a dead scope (INV-01/12).
 *
 * @public
 */
export interface Scope {
  /** Aborted before the disposers run; long-running setup watches this. */
  readonly signal: AbortSignal;
  /**
   * Registers a disposer to run at scope disposal.
   *
   * @throws `INVALID_STATE` when the scope is already disposed.
   */
  onDispose(disposer: () => void | Promise<void>): void;
  /**
   * Acquires a resource owned by this scope: the disposer runs LIFO at
   * disposal, exactly once (INV-05).
   *
   * @throws `INVALID_STATE` when the scope is already disposed, or when the
   * scope aborts while `create` is pending (with the abort cause).
   */
  acquire<T>(create: () => T | Promise<T>, dispose: (value: T) => void | Promise<void>): Promise<T>;
  isDisposed(): boolean;
  [Symbol.asyncDispose](): Promise<void>;
}

interface Entry {
  run: () => Promise<void>;
}

function disposedError(reason: string, cause?: unknown): MoltError {
  return new MoltError(
    { code: 'INVALID_STATE', message: 'scope is disposed', details: { reason } },
    cause,
  );
}

export class ScopeImpl implements Scope {
  readonly #controller = new AbortController();
  #entries: Entry[] = [];
  #disposed = false;
  #disposePromise: Promise<DisposalReport> | undefined;

  get signal(): AbortSignal {
    return this.#controller.signal;
  }

  isDisposed(): boolean {
    return this.#disposed;
  }

  onDispose(disposer: () => void | Promise<void>): void {
    if (this.#disposed) {
      // Late registration is a bug, not a no-op (plan 03 §4 edge list).
      throw disposedError('onDispose after dispose');
    }
    this.#entries.push({ run: idempotent(disposer) });
  }

  async acquire<T>(
    create: () => T | Promise<T>,
    dispose: (value: T) => void | Promise<void>,
  ): Promise<T> {
    if (this.#disposed) {
      throw disposedError('acquire on disposed scope');
    }
    // A creation error is the caller's error, not a core error: it propagates
    // untouched and nothing is registered — ownership never attaches to a
    // failed creation (plan 03 §4). The runtime wraps it with cause intact.
    const value = await create();
    // No await between this check and the push below: a scope cannot start
    // disposing between the two, so an acquired resource is always either
    // registered or immediately disposed — never orphaned (INV-01/12).
    if (this.#disposed) {
      // The scope began disposing while `create` was in flight. The value
      // was resolved but must not outlive the dead scope: dispose it here,
      // then reject (plan 03 §4 edge list).
      let disposalCause: unknown;
      try {
        await dispose(value);
      } catch (error) {
        disposalCause = error;
      }
      throw disposedError('scope disposed during acquire', disposalCause);
    }
    this.#entries.push({ run: idempotent(() => dispose(value)) });
    return value;
  }

  dispose(): Promise<DisposalReport> {
    // Idempotent and concurrency-safe (INV-05): every caller awaits the one
    // real disposal and receives the same frozen report.
    if (this.#disposePromise !== undefined) {
      return this.#disposePromise;
    }
    this.#disposed = true;
    // The signal aborts BEFORE any disposer runs: in-flight work observes the
    // abort while cleanup is still ahead of it (plan 04 §2 scope test 9).
    this.#controller.abort();
    const entries = this.#entries;
    this.#entries = [];
    const errors: unknown[] = [];
    const run = async (): Promise<DisposalReport> => {
      // Reverse iteration over a copy: LIFO (INV-02), no indexed access.
      for (const entry of [...entries].reverse()) {
        // A failing disposer never prevents later disposers; every failure is
        // collected (INV-03). Async disposers are awaited in sequence, so
        // teardown order is deterministic.
        try {
          await entry.run();
        } catch (error) {
          errors.push(error);
        }
      }
      const report: DisposalReport = Object.freeze({ errors: Object.freeze([...errors]) });
      return report;
    };
    this.#disposePromise = run();
    return this.#disposePromise;
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.dispose();
  }
}
