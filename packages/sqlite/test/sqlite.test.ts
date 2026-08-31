import { expectGenerationDisposed, fakeResources, pluginHarness } from '@molt/test';

import type { AppliedMigration, DatabaseConnection, MigrationLedger } from '../src/index.js';
import { applyMigrations, createDatabaseAdmin, migrationChecksum } from '../src/index.js';

function fakeDatabase(): {
  connection: DatabaseConnection;
  ledger: MigrationLedger;
  executed: string[];
  records: AppliedMigration[];
} {
  const executed: string[] = [];
  const records: AppliedMigration[] = [];
  return {
    executed,
    records,
    connection: {
      execute: (sql) => {
        executed.push(sql);
        return Promise.resolve();
      },
      close: () => undefined,
    },
    ledger: {
      list: () => Promise.resolve([...records]),
      record: (record) => {
        records.push(record);
        return Promise.resolve();
      },
      transaction: async (work) => work(),
    },
  };
}

describe('SQLite adapter (P3-4, persistence boundary)', () => {
  it('INV-10: applies ordered migrations and rejects edited checksums', async () => {
    const database = fakeDatabase();
    await applyMigrations(database.connection, database.ledger, [
      { id: '002-add-index', owner: 'plugin.b', body: 'CREATE INDEX b;' },
      { id: '001-create-table', owner: 'plugin.a', body: 'CREATE TABLE a;' },
    ]);
    expect(database.executed).toEqual(['CREATE TABLE a;', 'CREATE INDEX b;']);
    expect(migrationChecksum('CREATE TABLE a;')).toHaveLength(64);
    await expect(
      applyMigrations(database.connection, database.ledger, [
        { id: '001-create-table', owner: 'plugin.a', body: 'ALTER TABLE a;' },
      ]),
    ).rejects.toMatchObject({ code: 'INVALID_STATE', details: { reason: 'checksum-mismatch' } });
  });

  it('05 §5: explicit host destruction backs up first', async () => {
    const order: string[] = [];
    const admin = createDatabaseAdmin({
      backup: () => {
        order.push('backup');
      },
      destroy: () => {
        order.push('destroy');
      },
    });
    await admin.destroy();
    expect(order).toEqual(['backup', 'destroy']);
  });

  it('INV-01/12: a checksum failure after connection acquisition leaves no live connection', async () => {
    const resources = fakeResources();
    const database = fakeDatabase();
    database.records.push({
      id: '001-create-table',
      owner: 'plugin.a',
      checksum: migrationChecksum('CREATE TABLE original;'),
    });
    const harness = pluginHarness({
      id: 'sqlite.test.plugin',
      version: '1.0.0',
      setup: async (context) => {
        const resource = resources.connectionHost();
        await context.scope.acquire(resource.create, resource.dispose);
        await applyMigrations(database.connection, database.ledger, [
          { id: '001-create-table', owner: 'plugin.a', body: 'ALTER TABLE changed;' },
        ]);
      },
    });
    await expect(harness.run()).rejects.toMatchObject({
      code: 'INVALID_STATE',
      details: { reason: 'checksum-mismatch' },
    });
    await harness.dispose();
    await expectGenerationDisposed(harness.runtime, 'sqlite.test.plugin');
    resources.expectNoLeaks();
  });
});
