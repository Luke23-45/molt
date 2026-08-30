# Molt

A general plugin runtime for safe replacement, in TypeScript.

> **Thesis** — a plugin is a versioned capability provider running inside an
> owned resource scope. A replacement is prepared in isolation, committed only
> after successful preparation, and followed by disposal of the previous
> generation.

The name is the mechanism: a crab grows a new exoskeleton beneath the old one
and sheds the old shell only after the new one is complete. A failed molt
leaves the old shell intact.

## The problem it solves

Every plugin system can *start* and *stop* plugins. Almost none can *replace*
one safely. Swapping a live plugin for a new version of it — a new dependency
bundle, a hot-reloaded module, an upgraded driver — is a transaction: the new
version must be prepared without disturbing the old one, committed only if
preparation fully succeeds, and the old generation must then be disposed
completely. Get any of that wrong and a failed upgrade has already torn down
the working system.

Molt makes that transaction the primitive. The engine enforces fifteen named
invariants (INV-01…INV-15, [`docs/implement_plan/00`](docs/implement_plan/00-system-architecture.md)),
each proven by tests, including nine transaction gates written before the
implementation existed:

| Guarantee | Statement |
|---|---|
| Failed replacement | A candidate whose setup fails is disposed completely; the old generation stays active **and usable** (INV-01/07) |
| Atomic commit | Staged capabilities and contributions are invisible until commit; after commit there is no rollback — ever (INV-06/08) |
| Owned resources | Every resource belongs to a scope; disposal runs LIFO, survives disposer failures, and leaves zero live resources (INV-02/03/12) |
| Dependents | Stopping a provider with active dependents is rejected unless cascade is explicit, ordered, and recorded (INV-11) |
| Structured failures | Every failure is a `MoltError` with a stable code — never a warning, never a log line (INV-10) |
| No globals | Runtime instances share nothing; resolution is deterministic and order-independent (INV-13) |

## Non-goals

- **Not a sandbox.** Plugins are trusted code; Molt governs lifecycle and
  capability *visibility*, not permissions.
- **Not an effect system.** No algebraic effects, no managed runtime — plugins
  are ordinary async functions with a scope.
- **Not a loader or bundler.** You hand Molt definitions; how they were
  imported is your business.
- **No global registry.** No `app.use(...)` singleton; the host owns instances.
- **No automatic rebinding.** v1 rejects provider replacement with active
  dependents rather than silently re-wiring them (ADR-03).

## Why not …

**…Effect?** Effect is a programming model — it replaces how you write
application logic. Molt is a lifecycle kernel — it governs how *plugins as
units of deployment* start, compose, and get replaced. They compose; they do
not compete.

**…TC39 `using` / `DisposableStack`?** Explicit resource management scopes a
resource to a lexical block you wrote ahead of time. It cannot resolve a
dependency graph, version-check providers, or atomically replace a
long-running generation while consumers hold its capabilities — Molt is built
out of scopes, not instead of them.

**…Cordis?** The closest existing system, and a good one. But its lifecycle
unit is start/stop: a failed "replacement" is a failed stop-plus-start — the
old generation is already gone. Molt's two-phase protocol keeps the old
generation serving until the new one is fully prepared and committed, and it
records disposal failures as inspectable diagnostics instead of rollback
attempts.

## Packages

| Package | Status |
|---|---|
| [`@molt/runtime`](packages/runtime-core/README.md) | The core runtime. Implemented; not yet released. |
| `@molt/test`, `@molt/events`, `@molt/react`, `@molt/vite`, `@molt/sqlite` | Planned (phases P2–P3 in [`docs/implement_plan/ledger.md`](docs/implement_plan/ledger.md)). |

## Development

```bash
pnpm install && pnpm verify   # typecheck + type-checked lint + knip
pnpm build                    # dual ESM/CJS via tsdown
pnpm test                     # unit suite (node + happy-dom)
pnpm test:coverage            # unit suite with coverage thresholds
pnpm test:property            # fast-check property suite (model-based)
pnpm test:stress              # stress suite (1k definitions, replace-100×, soak)
pnpm check:pkg                # publint + arethetypeswrong
pnpm check:arch               # dependency-cruiser core-purity rules
pnpm check:api                # api-extractor diff vs the reviewed API file
```

## Contributing

Read [`AGENTS.md`](AGENTS.md) and the design notes first — the invariants are
the product, and a PR that simplifies one to make implementation easier is
rejected regardless of what else it adds. See
[`CONTRIBUTING.md`](CONTRIBUTING.md) for the mechanics.

## License

[MIT](LICENSE)
