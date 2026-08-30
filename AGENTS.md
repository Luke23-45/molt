# AGENTS.md

Instructions for AI coding agents working in this repository. Followed by Codex, Cursor, Copilot, Gemini CLI, Aider, Zed, and other agents that read the [agents.md](https://agents.md) convention; deeper task-specific guidance lives in the skills under [`.agents/skills/`](./.agents/README.md).

## Project overview

**Molt** is a general plugin runtime for safe replacement, in TypeScript, published as the `@molt/*` npm packages. Thesis: _a plugin is a versioned capability provider running inside an owned resource scope; a replacement is prepared in isolation, committed only after successful preparation, and followed by disposal of the previous generation._

Status: **`@molt/runtime` implemented, not yet packaged.** All 11 core modules exist (`packages/runtime-core/src/`), 137 unit tests green including the nine transaction gates T-R1…T-R9, and gates G1–G6 pass locally. Remaining P1 work: property/stress suites (E7/E8), packaging (E10), API review (E11), README (E12). No build output, API-review file, or release exists yet. Check the progress log in [`docs/implement_plan/ledger.md`](docs/implement_plan/ledger.md) before assuming anything is built.

## Authority chain — read in this order

1. `docs/notes/01…08` — the design: thesis, guarantees, boundaries. **Decided.**
2. `docs/implement_plan/00…06` — the binding engineering plan: architecture, file contracts, gates, per-module specs.
3. `docs/implement_plan/ledger.md` — the only place work is tracked. Tick items there, with PR links.

Where they conflict, the notes define intent and the plan defines execution; a change to either must be made **in the same PR** as the code that motivates it. Never simplify a guarantee in note 01/03 to make implementation easier — see the skill `molt-lifecycle-semantics`.

## Commands

```bash
pnpm install && pnpm verify   # typecheck + lint + knip (must pass on fresh clone)
pnpm build                    # all packages (tsdown, dual ESM/CJS)
pnpm test                     # vitest unit project
pnpm test:property            # fast-check property suite
pnpm test:stress              # stress suite (1k+ definitions, replace-100x leak test)
pnpm check:pkg                # publint + arethetypeswrong per package
pnpm check:arch               # dependency-cruiser core-purity rules
pnpm check:api                # api-extractor diff vs reviewed API files
pnpm bench                    # comparison demo (naive registry vs Cordis vs Molt)
```

Until P1-E10 (packaging) lands, `build`, `check:pkg`, and `check:api` fail — that is expected; those ledger items create them. `test:property` and `test:stress` run vacuously until P1-E7/E8 add their suites.

## Code style — the short list

- TypeScript strictest settings (`strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`); DOM is excluded from `lib` in core.
- Named exports only; `readonly` everywhere it applies; **no `any`, no non-null assertions**; no decorators, no enums, no top-level await.
- Core throws only `MoltError` with a code from the fixed set (11 codes, see `docs/implement_plan/03-core-implementation-spec.md` §0). Never `console.*` — diagnostics go through `ctx.diagnose` / observer events.
- Comments state constraints and cite invariant IDs (INV-01…INV-15); they never narrate the next line.
- Every exported symbol has JSDoc with `@throws` codes.
- `runtime-core` has exactly one runtime dependency (`semver`). No browser, UI, or database imports — enforced by gate G6.

## Testing instructions

- Tests are named after the invariant they prove: `it('INV-07: …')`. A test without an INV or spec-section reference is rejected.
- The nine transaction tests (T-R1…T-R9) are release blockers; they were written **before** the implementation and must stay green forever.
- No real timers, no sleeping, no assertions on private state. Detail: skill `molt-testing`.

## PR instructions

Every PR states three things: what changed, which invariants (INV-xx) it touches, and which gates (G1–G10) prove it. Tick the corresponding ledger items with the PR link in the same PR. Conventional commit subjects (`feat:`, `fix:`, `docs:`, `test:`, `chore:`). `main` is protected; checks must pass; no admin override.

## Agent skills

Task-specific playbooks live in [`.agents/skills/`](./.agents/README.md) (Agent Skills format, [agentskills.io](https://agentskills.io/specification)):

| Skill                      | Load when                                                                        |
| -------------------------- | -------------------------------------------------------------------------------- |
| `molt-orientation`         | Starting any work in this repo — the map and the authority chain                 |
| `molt-coding-standards`    | Writing or reviewing any TypeScript in the packages                              |
| `molt-lifecycle-semantics` | Touching `runtime-core` source — invariants, state machine, replacement protocol |
| `molt-testing`             | Writing, changing, or reviewing tests                                            |
| `molt-workflow`            | Completing ledger tasks or opening PRs                                           |
| `molt-packaging`           | Changing `package.json`, exports, the public API surface, or releasing           |

Nested `AGENTS.md` files inside `packages/*` may be added as packages are created; the nearest file to an edited source wins.
