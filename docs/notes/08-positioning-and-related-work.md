# 8. Positioning and Related Work

This document records how Molt relates to existing systems and why the niche is worth building. It must be revised whenever a competitor closes the gap. Last reviewed: 2026-08-30.

## The claim Molt makes

Installation is easy in most plugin systems; removal and replacement are vague. The specific claim is narrower:

> A failed candidate replacement leaves the previous generation active, usable, and serving, and a successful replacement leaks nothing.

This claim is falsifiable. It is demonstrated by the transaction gates and the comparison demo in [6](./06-validation-and-release-gates.md), not by assertion.

## Existing systems

| System | What it provides | What it does not provide |
|---|---|---|
| [Cordis](https://github.com/cordiverse/cordis) (Koishi; adopted by DeepSeek Harness) | context-scoped plugins, service injection, lifecycle events, disposal propagation | no guarantee that a failed reload keeps the old generation active; API documented as unstable; official docs still under construction |
| [Effect `Layer` / `Scope`](https://effect.website/docs/v3/requirements-management/layers) | transactional resource graphs, reverse-order release, release on failure or interruption | requires adopting the Effect paradigm; no plugin generations, staged contributions, or host-neutral registry |
| [TC39 Explicit Resource Management](https://github.com/tc39/proposal-explicit-resource-management) (`using`, `Symbol.dispose`) | language-native deterministic disposal (Stage 4 in 2025; TypeScript 5.2+) | disposal only: no ownership graph, no staged publication, no replacement protocol |
| [Avvio](https://github.com/fastify/avvio) (Fastify) | async boot ordering, close handlers | boot-time only; no replacement at all |
| NestJS lifecycle, `@loopback/context`, Gasket | framework lifecycle hooks, dependency injection, plugin orchestration | framework-tied; no candidate/commit protocol |
| [Asqium](https://scispace.com/pdf/asqium-a-javascript-plugin-framework-for-extensible-client-57qak5g21f.pdf) | academic plugin framework with hot-swap | research prototype; not maintained for production |
| Host-specific plugin systems (Koishi plugins, Pi coding-agent extensions, Obsidian, Homebridge) | proven ecosystems | bound to one host; the lifecycle is not reusable |

## Why the niche is still open

Targeted searches for transactional, blue-green, or two-phase plugin replacement found no maintained npm library that keeps the old generation active during a failed replacement. The combination is unoccupied; each part alone is not:

- disposal alone is becoming language-native;
- resource graphs alone exist in Effect;
- plugin lifecycle alone exists in Cordis.

If any of these systems ships the missing guarantee, this project loses its reason to exist and must be re-evaluated.

## Obligations that follow

- The comparison demo in [6](./06-validation-and-release-gates.md) must include a current Cordis release with its version recorded. Any claim about Cordis's behavior on failed reload must be demonstrated there, not assumed.
- `DisposableLike` and `Scope` must interoperate with `Symbol.dispose` and `Symbol.asyncDispose` so `using` declarations work inside plugins.
- Documentation must answer "why not Effect" and "why not `using`" in the first screen of the README.

## Naming record

**Molt** is the name. The metaphor is biologically exact: a crab grows a new exoskeleton beneath the old one and sheds the old shell only after the new one is complete; a failed molt leaves the old shell intact. That is the replacement protocol.

Alternatives considered and rejected:

- **Escrow** — exact for the commit protocol but dry, and crowded by fintech and blockchain usage.
- **Chrysalis** — implies dormancy; the interesting phase here is the transition.
- **Baton** — captures handover but not preparation or failure.
- **Lineage** — captures generations but collides with LineageOS in search.

Publication notes (checked 2026-08-30):

- the unscoped npm packages `molt`, `escrow`, `chrysalis`, and `baton` exist but are dormant one-offs; none is a live collision;
- publishing under the `@molt` scope avoids the reserved unscoped name entirely;
- `github.com/molt` is a dormant personal account, not a project; the repository lives at `github.com/Luke23-45/molt` under the author's account (amended 2026-09-07: the `moltjs` organization was never created);
- a Python tool called PyMolt already uses the molt metaphor for dependency upgrades, which confirms the metaphor reads correctly to developers; it is a different ecosystem and a different problem.
