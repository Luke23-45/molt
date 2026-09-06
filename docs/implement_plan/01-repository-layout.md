# 01 — Repository Layout

The repository is a pnpm-workspace monorepo, following the layout conventions of the strongest TypeScript library monorepos surveyed for note [08](../notes/08-positioning-and-related-work.md): Effect (pnpm + changesets + vitest, root-centralized strict configs) and Cordis (packages under one workspace, shared root configs, lean per-package files).

## 1. Final repository tree

```text
molt/
├── .github/
│   ├── workflows/            # verify.yml, release.yml (see 06)
│   ├── ISSUE_TEMPLATE/       # bug report, lifecycle-semantics report, feature
│   ├── CODEOWNERS
│   ├── dependabot.yml
│   └── PULL_REQUEST_TEMPLATE.md
├── packages/
│   ├── runtime-core/         # @molt/runtime        (P1)
│   ├── test/                 # @molt/test           (P2)
│   ├── events/               # @molt/events         (P3)
│   ├── react/                # @molt/react          (P3)
│   └── vite/                 # @molt/vite           (P3)
├── examples/
│   ├── command-host/         # unrelated host #1    (P2)
│   ├── worker-host/          # unrelated host #2    (P2)
│   └── integration-demo/     # full-public-surface integration host (added post-P3, 2026-09-07)
├── demo/
│   └── comparison/           # three-way demo vs naive registry + Cordis (P3)
├── docs/                     # design notes + this plan (already present)
├── package.json              # private root; scripts only, no deps but tooling
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── tsconfig.base.json        # strictest shared options
├── tsconfig.packages.json    # extends base; shared by all packages
├── tsconfig.tests.json       # extends base; test-only options
├── eslint.config.js          # flat config, type-checked
├── prettier.config.js
├── vitest.config.ts          # root test projects: unit / property / stress
├── api-extractor.json        # per package via extends
├── .cruiser.json             # dependency-cruiser architecture rules
├── knip.json
├── LICENSE                   # MIT
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
├── SECURITY.md
├── README.md
└── .gitignore
```

Directory names are the working names from note [07](../notes/07-implementation-roadmap.md); published names carry the `@molt` scope (note [05](../notes/05-adapters-and-host-integration.md) charters, note [08](../notes/08-positioning-and-related-work.md) naming record).

## 2. Workspace configuration

- **Package manager: pnpm** (pinned major version in `packageManager` field). Rationale: strict node_modules layout, workspace protocol (`workspace:*`), fastest installs on CI.
- **`pnpm-workspace.yaml`:** `packages: ['packages/*', 'examples/*', 'demo/*']`.
- **Engines:** `node >= 22` and `pnpm >= 10`. Node 20 reached end-of-life 2026-04-30; Node 22 is maintenance LTS until 2027 and Node 24 is active LTS — supporting EOL runtimes in a public library is a liability, not a feature. CI tests 22 and 24. Bun is a verified secondary environment via a dist-import smoke test, not an engine target (ADR-13); Bun ignores `engines`, so no field changes.
- **Inter-package dependencies** use `workspace:*` and are mirrored in `peerDependencies` for published adapter packages (adapters declare `@molt/runtime` as a peer with a version range, never a hard dependency).

## 3. TypeScript strategy

One base config, extended by packages and tests — the split used by Effect (`base` / `packages` / `tests`). `tsconfig.base.json`:

```jsonc
{
  "compilerOptions": {
    "target": "es2022",              // native Error.cause, .at(), structured clone-free code
    "lib": ["es2022", "esnext.disposable"], // disposable protocol typed for ADR-09 (TC39 Stage 4); DOM stays excluded
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true             // speed; attw (G8) covers cross-resolution types
  }
}
```

Non-negotiables: `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`. `lib` excludes DOM everywhere in core — a DOM leak fails typecheck, not just review (reinforces gate G6).

Tests additionally include `types: ["node", "vitest/globals"]` and the DOM-free environment shims the test kit provides.

## 4. Package manifest template

Every published package uses this shape (`@molt/runtime` shown; ADR-07):

```jsonc
{
  "name": "@molt/runtime",
  "version": "0.1.0",
  "description": "A general plugin runtime for safe replacement.",
  "type": "module",
  "license": "MIT",
  "files": ["dist", "README.md"],
  "exports": {
    ".": {
      "import": {
        "types": "./dist/index.d.ts",
        "default": "./dist/index.js"
      },
      "require": {
        "types": "./dist/index.d.cts",
        "default": "./dist/index.cjs"
      }
    },
    "./package.json": "./package.json"
  },
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "sideEffects": false,
  "engines": { "node": ">=22" },
  "dependencies": { "semver": "^7.7.0" },
  "scripts": {
    "build": "tsdown",
    "test": "vitest run",
    "lint": "eslint . && prettier --check .",
    "typecheck": "tsc --noEmit"
  }
}
```

Rules the template encodes: `files` whitelists (nothing accidental ships); `exports` has exactly one public entry plus `./package.json`; internal modules are unreachable by construction (note [06](../notes/06-validation-and-release-gates.md) build checks); `sideEffects: false` keeps tree-shaking honest; the semver range is the only dependency core ever declares (ADR-02). The `require` condition carries its own `.d.cts` types — a single shared `types` condition masquerades as ESM for CJS consumers and fails gate G7 (publint/attw, confirmed when P1-E10 landed).

## 5. The file-by-file contract for `runtime-core`

Each file owns exactly one responsibility and is forbidden from reaching outside it. Sizes are guidance to keep files reviewable, not quotas.

| File | Owns | Must never contain | ~LOC |
|---|---|---|---|
| `src/capability.ts` | `capability()` factory, token/policy types, id+version grammar validation | resolution logic, runtime state | ≤120 |
| `src/definition.ts` | `PluginDefinition`, `Requirement`, `ProvidedCapability` types; definition validation + freeze | lifecycle, scope logic | ≤160 |
| `src/errors.ts` | `MoltError`, `RuntimeErrorCode`, `DisposalReport`, cause wrapping | any throwing of its own beyond constructors | ≤180 |
| `src/resolver.ts` | graph construction, selection, version checks, cycle detection, `ResolutionPlan`, blocked-plugin diagnostics | I/O, timing, lifecycle | ≤400 |
| `src/scope.ts` | `Scope`, disposal engine, idempotent disposer wrapper, `Symbol.asyncDispose` (ADR-09) | capability knowledge | ≤250 |
| `src/contributions.ts` | `ContributionKey`, staged sets, commit/withdraw snapshots | rendering, host concepts | ≤150 |
| `src/runtime.ts` | `createRuntime`, lifecycle engine, queues, replacement protocol, observer bus | algorithmic details that belong in resolver/scope | ≤500 |
| `src/inspection.ts` | `RuntimeInspection` builders, blocked-plugin tree rendering | mutation of runtime state | ≤150 |
| `src/internal/semver.ts` | `satisfies`, `valid`, comparison — the only import of `semver` | anything else | ≤60 |
| `src/internal/async.ts` | deferreds, per-id queues, async mutex, idempotent wrapper (shared by scope + runtime) | domain types | ≤150 |
| `src/index.ts` | the public re-export surface (§10 of [03](./03-core-implementation-spec.md)) | logic of any kind | ≤60 |

Tests mirror the source files one-to-one, plus `test/replacement.test.ts` which is written first (P0) and encodes the transaction gates of note [06](../notes/06-validation-and-release-gates.md).

## 6. Coding standards

- **Named exports only** in core; no default exports (consumer tooling and re-export ergonomics).
- **`readonly` on every interface property** that is conceptually immutable; public snapshot types use `readonly` arrays and `ReadonlyMap`/`ReadonlySet` so callers cannot mutate runtime state.
- **No `any`, no non-null assertions, no `as` except at validated boundaries** (each one carries a comment stating the invariant that makes it sound).
- **Errors:** core throws only `MoltError`. Helpers that receive foreign throwables wrap with `MoltError.from`. Never swallow; never `console.*` — diagnostics go through `ctx.diagnose` / observer events.
- **Comments:** state constraints and invariants (referencing INV-xx IDs), never narrate the next line. If a line needs narration, the line is wrong.
- **Public API JSDoc** on every export with `@throws <CODE>` tags; the API review gate (G9) fails on undocumented exports.
- **Imports:** `node:` builtins (only where unavoidable), external packages, internal `./`, in that order; enforced by lint.
- **No top-level await, no decorators, no enums** (string-literal unions instead), no namespace syntax (ADR-12).

## 7. What is deliberately absent

No global registry, no singleton runtime, no module-level mutable state (INV-13). No decorators or reflect-metadata (ADR-12). No polyfills for `AbortController`/`EventTarget` (Node ≥ 22 and every evergreen browser provide them). No plugin file loader or package installer in core (note 01 non-goals). No default export, no UMD/IIFE bundle — bundlers and Node are the only consumption paths.
