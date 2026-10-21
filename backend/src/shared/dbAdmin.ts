import { PrismaClient } from '@prisma/client';
import { databaseName } from './dbUrl';

/**
 * Creates (or drops and recreates) the database named in `url`.
 * Connects through `information_schema`, which every MySQL account can open, so the account
 * only needs privileges on the MediQueue databases themselves — not on the `mysql` system schema.
 */
export async function ensureDatabase(url: string, opts: { fresh?: boolean } = {}): Promise<void> {
  const name = databaseName(url);
  const adminUrl = new URL(url);
  adminUrl.pathname = '/information_schema';
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
  try {
    if (opts.fresh) await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS \`${name}\``);
    await admin.$executeRawUnsafe(`CREATE DATABASE IF NOT EXISTS \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  } finally {
    await admin.$disconnect();
  }
}
