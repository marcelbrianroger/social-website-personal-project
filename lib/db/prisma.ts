import { PrismaPg } from '@prisma/adapter-pg'

import { PrismaClient } from '@/lib/generated/prisma/client'

/**
 * Prisma Client singleton.
 *
 * Prisma 7 requires an explicit driver adapter — the implicit engine-managed
 * connection of v5/v6 is gone, so `new PrismaClient()` with no adapter throws.
 *
 * Each client owns a connection pool. Next.js reloads modules on every edit in
 * dev, so the instance is parked on `globalThis` to stop hot-reload from opening
 * a new pool per save until Postgres refuses connections.
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL

  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env and start Postgres with `npm run db:start`.',
    )
  }

  const adapter = new PrismaPg({ connectionString })

  return new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === 'development'
        ? ['warn', 'error']
        : ['error'],
  })
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
