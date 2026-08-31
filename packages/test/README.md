# @molt/test

The Molt test host provides observable fake resources and public-API assertions for ownership,
replacement, disposal, and leak invariants. It deliberately uses only the public `@molt/runtime`
surface; it does not read runtime internals or coordinate lifecycle operations.
