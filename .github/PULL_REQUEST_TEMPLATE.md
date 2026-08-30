<!--
  The three points below are required, not decorative. A PR that cannot fill
  them in is not ready for review.
-->

## What changed

<!-- One paragraph, plain language. -->

## Which invariants it touches

<!-- INV-01…INV-15 from docs/implement_plan/00-system-architecture.md §2.
     If lifecycle behavior is affected, name the invariants and the tests that
     re-prove them. Write "none" only if the change provably cannot touch them. -->

## Which gates prove it

<!-- G1–G10 from docs/implement_plan/02-tooling-and-quality-gates.md §3, with
     results (e.g. "G1 G2 G3 G4 green locally; CI runs the full matrix"). -->

## Checklist

- [ ] Ledger items ticked with this PR's link (`docs/implement_plan/ledger.md`)
- [ ] Design notes / ADRs / agent skills updated in this PR if the change invalidates them
- [ ] No new TODOs, `any`, or non-null assertions introduced
