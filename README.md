# A General Plugin Runtime for Safe Replacement

This directory describes a possible standalone library extracted from the lessons of Sky.

The working thesis is:

> A plugin is a versioned capability provider running inside an owned resource scope. A replacement is prepared in isolation, committed only after successful preparation, and followed by disposal of the previous generation.

This is a design proposal, not a claim that the library already exists.

## Documents

1. [Thesis and boundaries](./01-thesis-and-boundaries.md) — what problem the library solves and what it refuses to promise.
2. [Core model and API](./02-core-model-and-api.md) — the host-neutral contracts.
3. [Lifecycle and transactionality](./03-lifecycle-and-transactionality.md) — activation, failure, replacement, and disposal semantics.
4. [Capabilities and dependencies](./04-capabilities-and-dependencies.md) — typed services, version ranges, provider selection, and dependent plugins.
5. [Adapters and host integration](./05-adapters-and-host-integration.md) — React, Vite HMR, persistence, and database integration outside the core.
6. [Validation and release gates](./06-validation-and-release-gates.md) — tests and evidence required before publication.
7. [Implementation roadmap](./07-implementation-roadmap.md) — an intentionally staged build plan with stop conditions.

## Non-negotiable design rules

- The core must run without React, Zustand, sql.js, IndexedDB, Vite, or browser globals.
- Every runtime-managed resource must have an owner and an idempotent disposer.
- A failed activation must leave no resource registered in the runtime.
- A failed replacement must leave the previous active generation intact.
- Dependency ambiguity, missing requirements, version conflicts, and cycles are errors—not warnings that are pushed to runtime.
- Uninstalling a plugin must not silently destroy persisted data.
- Security isolation is out of scope unless a separate sandbox host is used.

#
