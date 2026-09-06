# Molt publication readiness

Status: release automation and local publication checks are implemented. No
package is published by this repository until the npm and GitHub prerequisites
below are completed and the version pull request is reviewed and merged.

## Evidence checklist

| Evidence                       | Current state                                  | Evidence location or command                                                                                                |
| ------------------------------ | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Core package and release gates | Ready locally; publication itself is pending   | `pnpm verify`, `pnpm test`, `pnpm test:property`, `pnpm test:stress`, `pnpm check:arch`, `pnpm check:pkg`, `pnpm check:api` |
| Independent hosts              | Ready locally                                  | `examples/command-host`, `examples/worker-host`, `pnpm test:adapters`                                                       |
| Replacement and leak evidence  | Regenerated locally and uploaded by release CI | `demo/comparison/RESULTS.md`, `demo/comparison/benchmark.json`, `pnpm bench`                                                |
| Browser smoke                  | Ready locally and wired into release CI        | `pnpm test:browser`                                                                                                         |
| API reference docs             | Ready locally; deployed by CI on version tags  | `pnpm docs:build` (TypeDoc output in `docs/api/`), `.github/workflows/docs.yml`                                             |
| Limitations                    | Documented                                     | root `README.md`, `packages/runtime-core/README.md`, and design note [01](notes/01-thesis-and-boundaries.md)                |
| Invariant failures             | No known failures in the local suites          | INV-01 through INV-15 are covered by the unit, transaction, property, stress, host, and adapter suites                      |
| Simple-registry comparison     | Included                                       | `demo/comparison/RESULTS.md` and the root README comparison section                                                         |

The local evidence is not a claim that npm publication or remote CI has
already succeeded. Those facts require the public repository, branch rules,
the npm organization, and a GitHub-hosted release run.

## Release mechanism

`.github/workflows/release.yml` has three distinct paths:

1. Every push to `main` runs the complete release gate suite and regenerates
   the benchmark artifact.
2. The version action creates or updates a reviewed Changesets version pull
   request. It is not allowed to publish the pending `0.0.0` workspace.
3. A publish job runs only after the version pull request has been merged,
   pending changesets have been consumed, and every publishable package has a
   nonzero version. It uses npm trusted publishing through GitHub OIDC and
   creates the package tags and GitHub releases through the Changesets publish
   action.

The `workflow_dispatch` dry run is intentionally non-publishing. It calculates
the release plan, creates ephemeral snapshot versions in the runner, rebuilds
and checks all public packages, and runs `pnpm publish --dry-run` against five
package tarballs. It never requests an npm publish token and never creates a
dist-tag.

## One-time external setup

These actions cannot be completed by repository files alone:

1. Make `Luke23-45/molt` public. npm provenance requires a public repository
   and public packages.
2. Create or claim the `@molt` npm organization, then configure each of the
   five publishable packages for public access.
3. On npm, configure a GitHub Actions trusted publisher for each package with:
   - GitHub owner: `Luke23-45`
   - repository: `molt`
   - workflow filename: `release.yml`
   - environment name: `npm-release`
   - allowed action: `npm publish`
4. In GitHub Actions settings, allow the version action to create pull
   requests. Configure the `npm-release` environment with maintainer approval
   before the first real publish.
5. Protect `main` with pull requests, required `verify` and `release` checks,
   linear history, and no administrator bypass. Protect release tags if the
   repository plan supports tag rules.
6. Enable GitHub Pages with "GitHub Actions" as the build source. The
   `docs` workflow builds the TypeDoc API reference on every version tag
   (`v*`) and deploys it; nothing is published until Pages is enabled.

Trusted publishing uses short-lived OIDC credentials; no long-lived npm
publish token belongs in this repository. The release workflow requires Node
24 and a current npm CLI through the Node 24 runner.

## Positioning review

- Host agnostic: demonstrated by the independent command and worker hosts;
  neither shares application modules with the other.
- Failed replacement: the runtime keeps the old generation usable while a
  candidate prepares and disposes failed candidate resources; the comparison
  demo records this behavior against a naive registry and Cordis.
- Narrow guarantees: Molt owns lifecycle, capability visibility, resolution,
  and diagnostics. It is not a sandbox, loader, bundler, effect system, or
  automatic dependency rebinder.
- Practical benefit: hosts that need safe live replacement and owned cleanup
  get those semantics without adopting a global application registry.
- Scope: Sky integration is deliberately out of scope for this repository and
  is not a publication requirement.

The final publish decision remains human: publish after the external setup and
remote gates are green, or keep the repository internal without changing the
runtime contract.
