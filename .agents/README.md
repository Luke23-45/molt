# .agents — Agent Skills for Molt

Task-specific playbooks for AI coding agents, in the open [Agent Skills format](https://agentskills.io/specification): one directory per skill, each containing a `SKILL.md` with YAML frontmatter (`name` matching the directory, `description` as the activation trigger) followed by focused instructions.

## Why this exists

The quality of Molt's code depends on agents knowing the invariants before they type. These skills encode the binding rules from `docs/implement_plan/` so that any agent — in any tool — loads the right constraints at the right moment instead of improvising.

## Skills

| Directory | Purpose | Load when |
|---|---|---|
| [`molt-orientation/`](./skills/molt-orientation/SKILL.md) | Repo map, authority chain, current status | Starting any session in this repo |
| [`molt-coding-standards/`](./skills/molt-coding-standards/SKILL.md) | TypeScript rules, file contract, error model | Writing or reviewing package code |
| [`molt-lifecycle-semantics/`](./skills/molt-lifecycle-semantics/SKILL.md) | INV-01…INV-15, state machine, replacement protocol, disposal engine, concurrency | Touching `runtime-core` source |
| [`molt-testing/`](./skills/molt-testing/SKILL.md) | Invariant-named tests, T-R1…T-R9, property testing, forbidden patterns | Writing or reviewing tests |
| [`molt-workflow/`](./skills/molt-workflow/SKILL.md) | Ledger rules, DoD, PR checklist, doc-amendment sync | Completing tasks, opening PRs |
| [`molt-packaging/`](./skills/molt-packaging/SKILL.md) | Exports map, dual build, API review, changesets, release | Touching packaging, public API, or releases |

## Conventions

- Skill bodies stay under ~150 lines and reference the plan documents for depth; they never duplicate plan content they can point to.
- Every factual claim inside a skill traces to a document in `docs/`. If a skill and a plan document disagree, the plan wins and the skill gets fixed in the same PR.
- Update a skill **in the same PR** as the change that invalidates it (same rule as design-note amendments).

## Using with specific tools

- **agents.md-convention agents** (Codex, Cursor, Copilot, Gemini CLI, Aider, Zed, …): read the root [`AGENTS.md`](../AGENTS.md), which summarizes the essentials and links here.
- **Agent Skills–native clients** (Claude Code reads `.claude/skills/`, ZCode reads its skills dirs): copy or symlink the skill directories into the client's skill location — e.g. `cp -r .agents/skills/* .claude/skills/`. The frontmatter is standard, so no rewriting is needed.
- **Validation:** run `skills-ref validate .agents/skills/<name>` (the reference validator from the agentskills project) after editing frontmatter.
