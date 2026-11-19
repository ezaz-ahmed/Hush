import { z } from 'zod';
import type { Db } from './database.module.js';
import { consents, conversations, users } from './schema.js';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

// Blank counts as unset.
const allowedHostSchema = z
  .string()
  .optional()
  .transform((v) => v?.trim().toLowerCase() || undefined);

export interface SeedEnv {
  NODE_ENV?: string | undefined;
  DATABASE_URL: string;
  SEED_ALLOWED_HOST?: string | undefined;
}

const refuse = (reason: string): never => {
  // Reason only: never include the URL, host or any env value.
  throw new Error(`Refusing to seed: ${reason}`);
};

/** Fail-closed production guard. Pure; call before opening any connection. */
export function assertSeedAllowed(env: SeedEnv): void {
  if (env.NODE_ENV?.trim().toLowerCase() === 'production') refuse('NODE_ENV is production');

  let url: URL;
  try {
    url = new URL(env.DATABASE_URL);
  } catch {
    return refuse('SEED_ALLOWED_HOST does not match DATABASE_URL');
  }
  // pg lets ?host= / ?hostaddr= override the authority host, which would bypass the checks below.
  if (url.searchParams.has('host') || url.searchParams.has('hostaddr')) {
    return refuse('DATABASE_URL must not set host or hostaddr query parameters');
  }
  // URL does not lowercase the hostname of non-special schemes like postgresql:.
  const hostname = url.hostname.toLowerCase();
  if (LOCAL_HOSTS.has(hostname)) return;

  const allowed = allowedHostSchema.safeParse(env.SEED_ALLOWED_HOST);
  if (!allowed.success || allowed.data !== hostname) {
    refuse('SEED_ALLOWED_HOST does not match DATABASE_URL');
  }
}

const id = (n: number) => `5eed0000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const NOTICE_VERSION = '2026-11-01';
const GRANTED = new Date('2026-11-01T09:00:00Z');
const WITHDRAWN = new Date('2026-11-02T09:00:00Z');
const [U1, U2, U3] = [id(1), id(2), id(3)] as const;

// Fake rows only. audit_subject_id is left to the DB default; no messages or audit_logs (see SPEC).
export const SEED = {
  users: [
    { id: U1, createdAt: GRANTED }, // consented
    { id: U2, createdAt: GRANTED }, // consent withdrawn
    { id: U3, createdAt: GRANTED }, // never consented
  ],
  consents: [
    { id: id(11), userId: U1, noticeVersion: NOTICE_VERSION, purpose: 'chat', grantedAt: GRANTED },
    {
      id: id(12),
      userId: U2,
      noticeVersion: NOTICE_VERSION,
      purpose: 'chat',
      grantedAt: GRANTED,
      withdrawnAt: WITHDRAWN,
    },
  ],
  conversations: [
    { id: id(21), userId: U1, createdAt: GRANTED },
    { id: id(22), userId: U1, createdAt: GRANTED },
    { id: id(23), userId: U2, createdAt: GRANTED },
  ],
} as const;

/** Insert builders in FK order (users, consents, conversations). Inspectable with .toSQL(). */
export const seedQueries = (q: Pick<Db, 'insert'>) => [
  q
    .insert(users)
    .values([...SEED.users])
    .onConflictDoNothing(),
  q
    .insert(consents)
    .values([...SEED.consents])
    .onConflictDoNothing(),
  q
    .insert(conversations)
    .values([...SEED.conversations])
    .onConflictDoNothing(),
];

/** Runs all inserts in one transaction; rerunning inserts nothing. Returns inserted row counts per table. */
export const seed = (db: Db) =>
  db.transaction(async (tx) => {
    const counts: number[] = [];
    for (const query of seedQueries(tx)) counts.push((await query).rowCount ?? 0);
    const [usersCount = 0, consentsCount = 0, conversationsCount = 0] = counts;
    return { users: usersCount, consents: consentsCount, conversations: conversationsCount };
  });

/** Safe CLI error text: only our own messages pass; pg/DNS errors can carry host or username. */
export function seedErrorMessage(err: unknown): string {
  if (err instanceof Error && /^(Refusing to seed:|Invalid env:)/.test(err.message)) {
    return err.message;
  }
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? `seed failed ${code}` : 'seed failed';
}
