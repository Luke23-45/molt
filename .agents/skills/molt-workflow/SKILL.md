---
name: molt-workflow
description: The Molt development workflow — ledger ticking rules, the four-part Definition of Done, PR requirements (invariants touched, gates run), the design-note amendment sync rule, branch policy, and phase discipline. Use when completing any task from docs/implement_plan/ledger.md, opening a pull request, or deciding what to work on next.
license: MIT
metadata:
  author: moltjs
  version: "1.0"
---

# Molt workflow

Sources: `docs/implement_plan/README.md` (ground rules), `docs/implement_plan/ledger.md` (rules section), `docs/implement_plan/06-ci-release-and-governance.md` (§1–§2).

## Picking work

1. Read the progress log at the bottom of `docs/implement_plan/ledger.md`.
2. Take the first unchecked item of the current phase — phases are strictly ordered; a phase starts only when the previous one's exit gate is checked.
3. Read the plan documents the item references **before** writing anything. If the item is ambiguous, the referenced document wins; if the documents conflict, that is a bug in the docs — fix them first via the amendment rule below.

## Definition of Done (all four, every item)

1. Implementation.
2. Tests proving it — invariant-named, per the `molt-testing` skill.
3. Documentation — JSDoc on new API; plan/notes updated if behavior or decisions changed.
4. All gates green (`pnpm verify` + the phase-relevant gates G1–G10).

Anything less is `[ ]` in the ledger, whatever the diff looks like.

## Ledger rules

- Tick `[x]` only at DoD, appending the PR link: `- [x] **P1-D6** … (PR #12)`.
- **No partial ticks**; "almost" stays unchecked.
- **No untraceable tasks** — a task must exist in a plan document before it exists in the ledger. Add it to the plan first, then the ledger, then do the work.
- New ADRs land in `docs/implement_plan/00-system-architecture.md` §8; amendments to `docs/notes/` land in the **same PR** as the code that motivates them (00 §9). The notes and the code must never diverge silently.

## PR requirements

Every PR description states three things (template enforces them):

1. **What changed.**
2. **Which invariants** (INV-xx from 00 §2) the change touches or could affect.
3. **Which gates** (G1–G10) prove it, with their results.

Plus: conventional commit subject (`feat:`, `fix:`, `docs:`, `test:`, `chore:`); `main` is protected with required checks and linear history; no admin override to merge red. Skills and `AGENTS.md` are updated in the same PR when the change invalidates them.

## Commands

```bash
pnpm verify        # typecheck + lint + knip — before every push
pnpm test          # unit (also runs in CI matrix: node 22/24 × 3 OS × happy-dom)
pnpm test:property # fast-check suite
pnpm test:stress   # stress suite (nightly + PR-labeled)
pnpm check:pkg     # publint + attw (packaging changes)
pnpm check:arch    # dependency-cruiser (import-graph changes)
pnpm check:api     # api-extractor (public-surface changes)
pnpm bench         # comparison demo (demo changes)
```

## Phase discipline

- Core phase (P1) adds no database, UI, event bus, loader, or HMR bridge — note 07 forbids it, and adapter code in core is a gate-G6 violation, not a shortcut.
- Adapters (P3) use the core lifecycle API only — building a parallel lifecycle in an adapter is a rejected PR.
- Sky integration (P4) happens only after core is stable, per note 07; the compatibility layer is marked transitional.
- Publication (P5) is a checklist execution, not a vibe — the six evidence items in `docs/implement_plan/06` §4 gate it.
