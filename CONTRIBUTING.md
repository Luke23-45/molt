# Contributing to Molt

Thank you for contributing. Molt is a plugin runtime whose value is its failure behavior, so this repository has unusually hard rules — they exist because every one of them guards a guarantee, not a preference. Read [`AGENTS.md`](./AGENTS.md) for the two-minute version; the full contracts live in [`docs/notes/`](./docs/notes/README.md) (design) and [`docs/implement_plan/`](./docs/implement_plan/README.md) (execution).

## Setup

Two commands, from a fresh clone:

```bash
pnpm install
pnpm verify
```

`pnpm verify` runs typecheck, lint, and dead-code hygiene across all packages and must pass before you change anything else. Requires Node ≥ 22 (Node 20 is end-of-life and unsupported).

## Where work is tracked

[`docs/implement_plan/ledger.md`](./docs/implement_plan/ledger.md) is the single task tracker. Its rules are binding:

- Tick an item only when it meets the Definition of Done: **implementation + tests proving it + documentation + all gates green.** Append your PR link to the ticked line.
- No partial ticks. No new tasks that aren't traceable to a plan document — add the task to the plan first, then the ledger, then write code.
- Phases are strictly ordered (P0 → P5); a phase starts when the previous one's exit gate is checked.

## The PR checklist

Every pull request states three things:

1. **What changed** — one paragraph, plain language.
2. **Which invariants it touches** — the registry is INV-01…INV-15 in [`docs/implement_plan/00-system-architecture.md`](./docs/implement_plan/00-system-architecture.md) §2. If your change could affect lifecycle behavior, name the invariants and the tests that re-prove them.
3. **Which gates prove it** — G1–G10, defined in [`docs/implement_plan/02-tooling-and-quality-gates.md`](./docs/implement_plan/02-tooling-and-quality-gates.md) §3, with results.

Additionally:

- Conventional commit subjects (`feat:`, `fix:`, `docs:`, `test:`, `chore:`).
- If your change invalidates a design note, an agent skill, or an ADR, update it **in the same PR**. The notes and the code must never diverge silently.
- `main` is protected: required checks, linear history, no admin override for red checks.

## The non-negotiables

From the plan's ground rules — a PR violating any of these is rejected regardless of what it adds:

- No stubs: no `TODO` in place of behavior, no empty branches, no unexported-but-claimed capabilities.
- Core throws only `MoltError` with a code from the fixed set; never `console.*`; no `any`; no non-null assertions; no default exports in packages.
- `runtime-core` has exactly one runtime dependency (`semver`) and imports no browser, UI, or database module (gate G6).
- Tests are named after the invariant they prove (`INV-07: …`) and assert behavior through public API, observers, inspection, or test-kit counters — never private state.
- A failed replacement leaves the old generation active and usable. This is the product. Do not simplify it.

## Reporting problems

- Bugs and feature requests: GitHub issues (templates provided).
- Lifecycle semantics behaving differently than documented: use the **"Lifecycle semantics"** issue template and name the invariant (INV-xx) — this category is first-class in this project.
- Security: see [`SECURITY.md`](./SECURITY.md). Note that Molt's core is an orchestration and ownership library, not a sandbox — that classification matters for reports.
