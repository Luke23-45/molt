# 06 — CI, Release, and Governance

A public library's CI is its contract with contributors: every gate from [02 §3](./02-tooling-and-quality-gates.md) runs automatically, every release is reproducible, and every governance file exists before the first external issue arrives.

## 1. Pipelines

### `verify.yml` — every push and PR

| Stage   | Jobs                                                                           | Gates      |
| ------- | ------------------------------------------------------------------------------ | ---------- |
| static  | `typecheck` (node 24)                                                          | G1         |
| static  | `lint` + `knip`                                                                | G2, G5     |
| test    | matrix: {node 22, node 24} × {ubuntu, windows, macos} × {unit, property}       | G3, G4     |
| test    | `stress` (ubuntu, node 24, nightly + PR-labeled)                               | G4         |
| package | `build` → `publint` + `attw` → tarball clean-install test → dependency-cruiser | G6, G7, G8 |
| api     | `api-extractor` diff against reviewed `*.api.md`                               | G9         |
| demo    | `bench` artifact upload (release branch only)                                  | G10        |

Rules: `concurrency` cancels superseded runs; required status checks mirror this table; a red required check blocks merge — no admin override habit.

### `release.yml` — changesets versioning and publish workflow

`release.yml` is implemented as three guarded jobs:

1. `validate` runs `pnpm verify`, the unit/property/stress/adapter/browser
   suites, G6–G9, and `pnpm bench` (never release from a stale green).
2. `version` runs the Changesets version action on `main` and creates or
   updates a reviewed version pull request.
3. `publish` is allowed only after a versioned commit has landed with no
   pending changeset and no publishable package still at `0.0.0`. It uses the
   Changesets publish action, npm OIDC trusted publishing, and creates the
   package tags and GitHub Releases.

The manual `workflow_dispatch` dry run calculates the release plan, creates
ephemeral snapshot versions, rebuilds and repacks all six public packages,
and runs `pnpm publish --dry-run` without uploading to npm. Benchmark output
is uploaded as a release artifact for review; it is not silently committed by
CI because benchmark values are host-dependent. The committed baseline is
regenerated with `pnpm bench` before a release review.

npm organization `@molt` and one exact trusted-publisher configuration per
package are required before the first publish. The repository-specific setup
checklist is recorded in [`docs/release-readiness.md`](../release-readiness.md).

## 2. Branch policy

- `main` is protected: PRs only, required checks, linear history.
- Conventional commit subjects (`feat:`, `fix:`, `docs:`, `test:`, `chore:`) — changesets handles versioning, conventional subjects keep history greppable.
- Every PR description states: what changed, which invariants ([00 §2](./00-system-architecture.md)) are touched, and which gates prove it. The template prompts for all three.
- Docs amendments to `docs/notes/` land in the same PR as the code that makes them true ([00 §9](./00-system-architecture.md)) — the no-silent-divergence rule, enforced by review checklist.

## 3. Governance files (present before first public announcement)

| File                               | Contents                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LICENSE`                          | MIT, copyright "Molt contributors".                                                                                                                                                                                                                                                                                                                     |
| `README.md` (root)                 | The thesis in one screen; **"Why not Effect / why not `using` / why not Cordis"** answered on the first screen (note [08](../notes/08-positioning-and-related-work.md) obligation); the guarantees verbatim from note [01](../notes/01-thesis-and-boundaries.md) and their limits; link to `demo/comparison/RESULTS.md`; the deliberate non-goals list. |
| `CONTRIBUTING.md`                  | Two-command setup (`pnpm install && pnpm verify`); PR checklist (invariants touched, gates run, docs amended); the ground rules from the plan README restated.                                                                                                                                                                                          |
| `CODE_OF_CONDUCT.md`               | Contributor Covenant v2.1, unmodified.                                                                                                                                                                                                                                                                                                                  |
| `SECURITY.md`                      | Private vulnerability-report channel; supported versions table; explicit statement that core is not a sandbox (note [05 §Security](../notes/05-adapters-and-host-integration.md)) so reports are classified correctly.                                                                                                                                  |
| `CODEOWNERS`                       | `packages/runtime-core/` requires owner review — the invariants live there.                                                                                                                                                                                                                                                                             |
| `.github/ISSUE_TEMPLATE/`          | Bug report; **lifecycle-semantics report** (a first-class category: "a guarantee behaved differently than documented", asking for the INV id); feature request.                                                                                                                                                                                         |
| `.github/PULL_REQUEST_TEMPLATE.md` | The three-point checklist above.                                                                                                                                                                                                                                                                                                                        |

## 4. Publish-day checklist (maps note 06 "evidence required")

The P5 decision is made against this list — every item links to its evidence:

1. Working core package → `@molt/runtime` published, G1–G9 green on the release commit.
2. Two real host adapters or example hosts → `examples/command-host`, `examples/worker-host` (P2).
3. Reproducible replacement/leak benchmarks → `demo/comparison/RESULTS.md`, regenerated in CI, naive-registry and Cordis rows included.
4. Documented limitations → README non-goals + note [01](../notes/01-thesis-and-boundaries.md) "What transactional means here" mirrored into the package README.
5. No known lifecycle invariant failures → INV-01…INV-15 all green in the release run; any waiver documented with justification.
6. The "why a simple plugin list is insufficient" example → the demo's naive-registry row **and** a README code sample showing the identical failure.

If any item is missing, the release does not happen and the library stays internal — note [06](../notes/06-validation-and-release-gates.md) calls that a valid result, and so does this plan.

## 5. Documentation site (P5, optional)

TypeDoc HTML generated from the JSDoc required by ground rule 2, deployed to GitHub Pages on tags. Nothing hand-written that duplicates the API — duplication rots. Before P5, the README + `docs/` are the documentation; they are complete enough by construction (ground rules 2 and 3).
