/**
 * Host-owned SQLite capability and migration primitives for Molt.
 * @packageDocumentation
 */

import { createHash } from 'node:crypto';

import { capability, MoltError } from '@molt/runtime';

/** The connection operations a host-backed SQLite implementation must provide. @public */
export interface DatabaseConnection {
  /** Executes one migration statement or statement batch. */
  execute(sql: string): Promise<void>;
  /** Closes the host-owned connection without changing persisted schema. */
  close(): void | Promise<void>;
}

/** The standard capability token for a database connection. @public */
export const databaseConnection = capability<DatabaseConnection>('database.connection', '1.0.0');

/** One immutable migration body and its owning plugin identity. @public */
export interface Migration {
  /** Stable migration identifier used for ordering. */
  readonly id: string;
  /** Plugin id that owns this migration. */
  readonly owner: string;
  /** SQL body whose checksum is persisted. */
  readonly body: string;
}

/** The persisted record used to detect edited migrations. @public */
export interface AppliedMigration {
  /** Stable migration identity. */
  readonly id: string;
  /** Plugin identity that owns the migration. */
  readonly owner: string;
  /** Lowercase SHA-256 checksum of the migration body. */
  readonly checksum: string;
}

/** The ledger operations a database implementation performs transactionally. @public */
export interface MigrationLedger {
  /** Reads the committed migration records. */
  list(): Promise<readonly AppliedMigration[]>;
  /** Persists one record in the current transaction. */
  record(migration: AppliedMigration): Promise<void>;
  /** Provides the transaction boundary for schema and ledger writes. */
  transaction<T>(work: () => Promise<T>): Promise<T>;
}

/**
 * Computes the stable SHA-256 checksum for a migration body.
 * @throws `INVALID_STATE` when the body is not a string.
 * @public
 */
export function migrationChecksum(body: string): string {
  if (typeof body !== 'string') {
    throw migrationError('migration body must be a string', { reason: 'invalid-migration' });
  }
  return createHash('sha256').update(body, 'utf8').digest('hex');
}

function migrationError(message: string, details: Readonly<Record<string, unknown>>): MoltError {
  return new MoltError({ code: 'INVALID_STATE', message, details });
}

/**
 * Applies new migrations in deterministic order and rejects changed checksums.
 * @throws `INVALID_STATE` for malformed records, duplicate ids, or checksum/owner mismatches.
 * @throws Errors rejected by the connection or ledger transaction.
 * @public
 */
export async function applyMigrations(
  connection: DatabaseConnection,
  ledger: MigrationLedger,
  migrations: readonly Migration[],
): Promise<readonly AppliedMigration[]> {
  for (const migration of migrations) {
    if (
      typeof migration.id !== 'string' ||
      migration.id.length === 0 ||
      typeof migration.owner !== 'string' ||
      migration.owner.length === 0 ||
      typeof migration.body !== 'string'
    ) {
      throw migrationError('migration record is malformed', {
        reason: 'invalid-migration',
      });
    }
  }
  const ordered = [...migrations].sort((left, right) => left.id.localeCompare(right.id));
  const seen = new Set<string>();
  for (const migration of ordered) {
    if (seen.has(migration.id)) {
      throw migrationError(`duplicate migration ${migration.id}`, {
        reason: 'duplicate-migration',
      });
    }
    seen.add(migration.id);
  }
  const applied = new Map((await ledger.list()).map((record) => [record.id, record]));
  for (const migration of ordered) {
    const checksum = migrationChecksum(migration.body);
    const prior = applied.get(migration.id);
    if (prior !== undefined) {
      if (prior.checksum !== checksum || prior.owner !== migration.owner) {
        throw migrationError(`migration ${migration.id} checksum mismatch`, {
          reason: 'checksum-mismatch',
          migrationId: migration.id,
          owner: migration.owner,
        });
      }
      continue;
    }
    const record: AppliedMigration = Object.freeze({
      id: migration.id,
      owner: migration.owner,
      checksum,
    });
    await ledger.transaction(async () => {
      await connection.execute(migration.body);
      await ledger.record(record);
    });
    applied.set(record.id, record);
  }
  return Object.freeze(
    [...applied.values()].sort((left, right) => left.id.localeCompare(right.id)),
  );
}

/** A host-only destructive operation with a mandatory backup policy hook. @public */
export interface DatabaseAdmin {
  /** Backs up the database and then performs explicit data removal. */
  destroy(): Promise<void>;
}

/**
 * Creates the host-only destructive API; this object is never published as a capability.
 * @throws Errors rejected by the backup or destruction hooks.
 * @public
 */
export function createDatabaseAdmin(options: {
  readonly backup: () => void | Promise<void>;
  readonly destroy: () => void | Promise<void>;
}): DatabaseAdmin {
  return {
    destroy: async () => {
      await options.backup();
      await options.destroy();
    },
  };
}
