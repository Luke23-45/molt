---
name: molt-lifecycle-semantics
description: The binding lifecycle semantics of the Molt plugin runtime — invariant registry INV-01..INV-15, plugin state machine, two-phase replacement protocol, disposal engine, and the concurrency model with its deadlock rules. Use before touching any runtime-core source file, especially scope.ts, resolver.ts, or runtime.ts, and before any refactor that would simplify lifecycle behavior.
license: MIT
metadata:
  author: moltjs
  version: "1.0"
---

# Molt lifecycle semantics

Molt's product is failure behavior. This skill is the protection layer between an agent's instinct to simplify and the guarantees that make Molt worth existing. Sources: `docs/implement_plan/00-system-architecture.md` (§2, §4, §5), `docs/implement_plan/03-core-implementation-spec.md`, `docs/notes/03`.

## The invariant registry (binding — full table in 00 §2)

- **INV-01** an activation failure disposes every resource acquired by that attempt
- **INV-02** disposal runs LIFO within one scope
- **INV-03** disposal continues after an individual disposer fails; every failure is collected
- **INV-04** a scope commits at most once; an aborted scope can never commit
- **INV-05** a committed generation disposes at most once; `dispose` is idempotent
- **INV-06** staged capabilities/contributions are invisible before commit
- **INV-07** a failed replacement leaves the previous generation active **and usable**
- **INV-08** after commit, the old generation is never restored — even if its disposal fails
- **INV-09** a plugin can only resolve capabilities its declared requirements permit
- **INV-10** ambiguity/missing/conflict/cycle are structured errors, never warnings
- **INV-11** stopping a provider with active dependents is rejected by default; cascade is explicit, ordered, recorded
- **INV-12** every resource has an owner; a disposed generation owns zero live resources
- **INV-13** runtime instances share nothing; no global registry
- **INV-14** old-disposal failure after commit: replacement still succeeds, failure inspectable
- **INV-15** provider replacement with active dependents: whole-closure atomic or structured rejection — v1 rejects (ADR-03); never silent rebinding

## State machine

`installed → preparing → active → disposing → stopped`; failures exit `preparing` to `stopped`. All state lives in the `Runtime` instance; definitions are validated and frozen at `install` (ADR-06). The transition table in `docs/implement_plan/03` §7 is binding — including "start of a never-installed id is `INVALID_STATE`", not `MISSING_CAPABILITY`.

## Replacement protocol (the feature that justifies the runtime)

1. Validate the candidate (definition + capability declarations) **before** creating any scope.
2. If active dependents consume a capability the old generation provides and the candidate does not provide compatibly → reject with `REPLACEMENT_FAILED` + dependent path (INV-15 v1).
3. Prepare the candidate in a private scope while the old generation keeps serving (INV-07).
4. Commit: publish candidate snapshot → mark active → **then** dispose old scope. Old disposal failure = `DISPOSAL_FAILED` diagnostic, never rollback, never restore (INV-08, INV-14).

## Disposal engine

Abort the scope signal **first**, then run disposers LIFO, awaiting each; a failure is collected and disposal continues (INV-02/03). The idempotent wrapper memoizes the first call — including a rejected one — so a disposer runs exactly once (INV-05). `dispose()` never throws; it returns a `DisposalReport`. A resource whose `create` resolved after abort is disposed immediately and `acquire` rejects — nothing stays owned by a dead scope (INV-01/12).

## Concurrency model (deadlock rules — ADR-04)

- Per-plugin operation queues serialize `start`/`stop`/`replace` per id; queued operations re-read state when they run.
- `install`/`uninstall` mutate the definition table under one async mutex.
- When activation needs a provider started, use the **internal activation path** — never enqueue a public `start` on the provider from inside another plugin's operation. Nested queueing deadlocks; this is the one place "just await the public API" is wrong.
- Observers get frozen snapshots; a listener that synchronously re-enters lifecycle ops is rejected (`INVALID_STATE`), and a throwing listener becomes a diagnostic, never a lifecycle outcome.

## Never simplify these

- Do not publish staged state early "for reactivity" (INV-06).
- Do not restore the old generation after a failed *disposal* (INV-08) — the fix is diagnostics, not rollback.
- Do not replace queues with fire-and-forget promises; serialization is a note-03 requirement.
- Do not let a disposer failure abort the loop (INV-03) or make `dispose()` throw.
- Do not add silent provider re-binding when dependents are active (INV-15) — rejection with a path is the v1 contract.
- Do not "clean up" the candidate scope lazily or on GC — ownership is explicit and countable (INV-12).

If a task seems impossible without breaking one of these, stop and revise the plan documents first (00 §9 amendment rule) — not the guarantee.
