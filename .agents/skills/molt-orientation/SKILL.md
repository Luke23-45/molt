---
name: molt-orientation
description: Orients any agent in the Molt repository — what the project is, where design authority lives (docs/notes), where the binding engineering plan lives (docs/implement_plan), how the ledger tracks work, and the current build status. Use when starting any session or task in this repository, before reading or changing any file.
license: MIT
metadata:
  author: molt
  version: '1.0'
---

# Molt orientation

Molt is a general plugin runtime for safe replacement, written in TypeScript, to be published as `@molt/*` npm packages. Thesis:

> A plugin is a versioned capability provider running inside an owned resource scope. A replacement is prepared in isolation, committed only after successful preparation, and followed by disposal of the previous generation.

The name is the mechanism: a crab grows a new exoskeleton beneath the old one and sheds the old shell only after the new one is complete. A failed molt leaves the old shell intact.

## Repository map

```text
AGENTS.md                  # agent instructions (start here)
.agents/                   # agent skills (this directory)
docs/
  README.md                # docs index
  notes/01…08              # DESIGN: thesis, boundaries, guarantees, positioning — decided
  implement_plan/00…06     # EXECUTION: architecture, layout, gates, specs, tests — binding
  implement_plan/ledger.md # TRACKER: every deliverable as a checkable item
packages/                  # runtime-core, test, events, react, vite
examples/                  # command-host, worker-host (P2), integration-demo
demo/comparison/           # three-way demo: naive registry vs Cordis vs Molt (P3)
```

## Authority chain (in order of precedence for intent)

1. `docs/notes/01-thesis-and-boundaries.md` … `08-positioning-and-related-work.md` — what Molt is, its guarantees, its non-goals. These are **decided**; do not reinterpret them to make code easier.
2. `docs/implement_plan/00-system-architecture.md` … `06-ci-release-and-governance.md` — the binding engineering plan. Where a plan refinement touches a note, it is an ADR in 00 §8 and must be mirrored into the notes **in the same PR** (00 §9).
3. `docs/implement_plan/ledger.md` — the single task tracker. Work exists in the ledger or it does not exist. Ticking rules are in the `molt-workflow` skill.

## Status check — always do this first

Read the progress log at the bottom of `docs/implement_plan/ledger.md` and the first unchecked item. Never assume a package, script, or gate exists without a checked ledger item saying so. As of the 2026-09-07 session: P1/P2/P3 are complete with every local gate green (including the Stryker mutation experiment, the TypeDoc docs build, and the release dry run); the open items are remote evidence and owner actions only — branch protection on `main` (P0-A1), the remote CI matrix (P1-E9), human API sign-off (P1-E11), the release-branch artifact run (P3-8), and the npm publication prerequisites (P5-1/P5-3).

## Non-negotiables (full lists in the referenced docs)

- Every package states the problem it solves; one that cannot is not published (`docs/notes/README.md`).
- Core runs without React, Vite, sql.js, IndexedDB, or browser globals; it has exactly one runtime dependency (`semver`).
- Guarantees INV-01…INV-15 (`docs/implement_plan/00-system-architecture.md` §2) are the product. Quality gates G1–G10 (`docs/implement_plan/02-tooling-and-quality-gates.md` §3) are how they are proven.
- Molt's value is failure behavior. When something is hard to implement, the correct move is to consult `molt-lifecycle-semantics`, not to simplify the guarantee.

## Where to look things up

| Question                                            | Document                                                   |
| --------------------------------------------------- | ---------------------------------------------------------- |
| Why does this library exist; who is the competition | `docs/notes/01`, `docs/notes/08`                           |
| What does the public API look like                  | `docs/notes/02`, finalized in `docs/implement_plan/03`     |
| How must replacement/disposal behave                | `docs/notes/03`, algorithms in `docs/implement_plan/00` §4 |
| What tests must exist                               | `docs/implement_plan/04`                                   |
| What am I supposed to do next                       | first unchecked item in `docs/implement_plan/ledger.md`    |
