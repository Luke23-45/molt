# @molt/sqlite

This adapter keeps database persistence separate from plugin lifecycle. Migrations are ordered,
owned, and checksum-verified inside the backend transaction. Stopping a plugin closes its
connection but never rolls back an already-applied schema; destructive data removal is available
only through an explicit host-admin object with a backup hook.
