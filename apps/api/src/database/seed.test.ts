import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import * as schema from './schema.js';
import { assertSeedAllowed, SEED, seed, seedErrorMessage, seedQueries } from './seed.js';
import type { Db } from './database.module.js';

const REMOTE = 'postgresql://user:s3cret@ep-cool-123-pooler.eu.aws.neon.tech/db';
const REMOTE_HOST = 'ep-cool-123-pooler.eu.aws.neon.tech';

describe('assertSeedAllowed', () => {
  it('refuses NODE_ENV=production even for localhost', () => {
    expect(() =>
      assertSeedAllowed({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
      }),
    ).toThrow('Refusing to seed: NODE_ENV is production');
  });

  it('treats NODE_ENV case- and whitespace-insensitively', () => {
    expect(() =>
      assertSeedAllowed({
        NODE_ENV: ' Production ',
        DATABASE_URL: 'postgresql://u:p@localhost/db',
      }),
    ).toThrow('Refusing to seed: NODE_ENV is production');
  });

  it.each([
    'postgresql://u:p@localhost/db?host=ep-remote.neon.tech',
    'postgresql://u:p@127.0.0.1/db?hostaddr=1.2.3.4',
    `${REMOTE}?host=other.example.com`,
  ])('refuses host/hostaddr query overrides: %s', (url) => {
    let message = '';
    try {
      assertSeedAllowed({ DATABASE_URL: url, SEED_ALLOWED_HOST: REMOTE_HOST });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toBe(
      'Refusing to seed: DATABASE_URL must not set host or hostaddr query parameters',
    );
    for (const leak of ['remote', '1.2.3.4', 'other.example', 's3cret']) {
      expect(message).not.toContain(leak);
    }
  });

  it.each(['localhost', '127.0.0.1', '[::1]'])('allows %s', (host) => {
    expect(() =>
      assertSeedAllowed({
        NODE_ENV: 'development',
        DATABASE_URL: `postgresql://u:p@${host}:5432/db`,
      }),
    ).not.toThrow();
  });

  it.each([undefined, '', '   ', 'ep-other.eu.aws.neon.tech'])(
    'refuses a remote host when SEED_ALLOWED_HOST is %j',
    (allowed) => {
      expect(() => assertSeedAllowed({ DATABASE_URL: REMOTE, SEED_ALLOWED_HOST: allowed })).toThrow(
        'Refusing to seed: SEED_ALLOWED_HOST does not match DATABASE_URL',
      );
    },
  );

  it('allows an exact host match, case-insensitively', () => {
    expect(() =>
      assertSeedAllowed({ DATABASE_URL: REMOTE, SEED_ALLOWED_HOST: REMOTE_HOST.toUpperCase() }),
    ).not.toThrow();
  });

  it('refuses a suffix or prefix of the host', () => {
    expect(() =>
      assertSeedAllowed({ DATABASE_URL: REMOTE, SEED_ALLOWED_HOST: 'neon.tech' }),
    ).toThrow('Refusing to seed');
  });

  it('refuses an unparseable DATABASE_URL without echoing it', () => {
    expect(() => assertSeedAllowed({ DATABASE_URL: 'not a url s3cret' })).toThrow(
      'Refusing to seed',
    );
  });

  it('never leaks the URL, host or password in refusal messages', () => {
    const cases = [
      { NODE_ENV: 'production', DATABASE_URL: REMOTE, SEED_ALLOWED_HOST: REMOTE_HOST },
      { DATABASE_URL: REMOTE },
      { DATABASE_URL: 'not a url s3cret' },
    ];
    for (const env of cases) {
      let message = '';
      try {
        assertSeedAllowed(env);
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).toMatch(/^Refusing to seed: /);
      for (const secret of ['s3cret', 'neon.tech', 'ep-cool', 'postgresql']) {
        expect(message).not.toContain(secret);
      }
    }
  });
});

describe('SEED data', () => {
  const all = [...SEED.users, ...SEED.consents, ...SEED.conversations];
  const uuid = /^5eed[0-9a-f]{4}-0000-4000-8000-[0-9a-f]{12}$/;

  it('has unique, valid, 5eed-prefixed ids', () => {
    const ids = all.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(uuid);
  });

  it('has 3 users, 2 consents, 3 conversations', () => {
    expect([SEED.users.length, SEED.consents.length, SEED.conversations.length]).toEqual([3, 2, 3]);
  });

  it('only references seeded users', () => {
    const userIds = new Set(SEED.users.map((u) => u.id));
    for (const r of [...SEED.consents, ...SEED.conversations]) {
      expect(userIds.has(r.userId)).toBe(true);
    }
  });

  it('leaves auditSubjectId to the database default', () => {
    for (const u of SEED.users) expect(u).not.toHaveProperty('auditSubjectId');
  });

  it('has a withdrawn consent after its grant', () => {
    const consentRows: readonly { grantedAt: Date; withdrawnAt?: Date }[] = SEED.consents;
    const withdrawn = consentRows.filter((c) => c.withdrawnAt);
    expect(withdrawn).toHaveLength(1);
    expect(withdrawn[0]?.withdrawnAt?.getTime()).toBeGreaterThan(
      withdrawn[0]?.grantedAt.getTime() ?? Infinity,
    );
  });
});

describe('seedQueries', () => {
  // Lazy pool: never connects.
  const db = drizzle({ client: new Pool({ connectionString: process.env.DATABASE_URL }), schema });

  it('inserts users, consents, conversations in order, all on conflict do nothing', () => {
    const sqls = seedQueries(db).map((q) => q.toSQL().sql.toLowerCase());
    expect(sqls).toHaveLength(3);
    expect(sqls[0]).toContain('insert into "users"');
    expect(sqls[1]).toContain('insert into "consents"');
    expect(sqls[2]).toContain('insert into "conversations"');
    for (const sql of sqls) expect(sql).toContain('on conflict do nothing');
  });

  it('binds the seeded ids as params', () => {
    const params = seedQueries(db).map((q) => q.toSQL().params);
    const tables = [SEED.users, SEED.consents, SEED.conversations];
    tables.forEach((rows, i) => {
      for (const r of rows) expect(params[i]).toContain(r.id);
    });
  });
});

describe('seed', () => {
  // Fake db: transaction runs the callback; each insert chain resolves to the next canned rowCount.
  const fakeDb = (rowCounts: Array<number | null>) => {
    const queue = [...rowCounts];
    const tx = {
      insert: () => ({
        values: () => ({ onConflictDoNothing: () => Promise.resolve({ rowCount: queue.shift() }) }),
      }),
    };
    return { transaction: (cb: (t: typeof tx) => unknown) => cb(tx) } as unknown as Db;
  };

  it('returns per-table inserted row counts', async () => {
    await expect(seed(fakeDb([3, 2, 3]))).resolves.toEqual({
      users: 3,
      consents: 2,
      conversations: 3,
    });
  });

  it('reports 0 on a rerun (conflicts inserted nothing, rowCount may be null)', async () => {
    await expect(seed(fakeDb([0, null, 0]))).resolves.toEqual({
      users: 0,
      consents: 0,
      conversations: 0,
    });
  });
});

describe('seedErrorMessage', () => {
  it.each(['Refusing to seed: NODE_ENV is production', 'Invalid env: DATABASE_URL'])(
    'passes through %j',
    (m) => expect(seedErrorMessage(new Error(m))).toBe(m),
  );

  it('hides other messages (may carry host or username)', () => {
    const err = new Error('getaddrinfo ENOTFOUND ep-secret.neon.tech user=bob');
    expect(seedErrorMessage(err)).toBe('seed failed');
  });

  it('adds a string code only', () => {
    const coded = Object.assign(new Error('connect ECONNREFUSED 10.0.0.1'), {
      code: 'ECONNREFUSED',
    });
    expect(seedErrorMessage(coded)).toBe('seed failed ECONNREFUSED');
    expect(seedErrorMessage(Object.assign(new Error('x'), { code: 5 }))).toBe('seed failed');
    expect(seedErrorMessage('boom')).toBe('seed failed');
  });
});
