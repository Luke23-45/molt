# @molt/react

The React adapter reads committed contribution snapshots from `@molt/runtime`. It does not expose
staged replacement state, and a contribution's component state is not promised to survive a
generation replacement. Use host-provided capabilities for durable application state.
