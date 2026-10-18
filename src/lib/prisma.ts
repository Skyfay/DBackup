import { PrismaClient } from '@prisma/client'
import { logger } from '@/lib/logging/logger'
import { wrapError } from '@/lib/logging/errors'
import { tenantScopeExtension } from '@/lib/tenant/prisma-scope'
import { relationOrderPaging } from '@/lib/prisma-paging'

const log = logger.child({ module: 'Prisma' })

// Add BigInt serialization support for JSON
// This prevents "TypeError: Do not know how to serialize a BigInt" when passing data to client components
// @ts-expect-error - BigInt toJSON is not in standard types
BigInt.prototype.toJSON = function () {
  return this.toString()
}

// ── SQLite Hardening ─────────────────────────────────────────
// Forces a single physical connection (connection_limit=1) so PRAGMA settings
// (WAL, busy_timeout) reliably apply to every query and writers never compete
// against each other over separate file handles. Applied here so users don't
// need to change their DATABASE_URL - the hardening is transparent to the setup.
const SQLITE_BUSY_TIMEOUT_MS = 5000

// WAL mode is on by default (recommended). Set SQLITE_WAL_MODE=false to opt out,
// e.g. when the /data volume lives on a filesystem that doesn't support WAL's
// shared-memory locking (some network shares/NFS mounts).
const isWalModeEnabled = process.env.SQLITE_WAL_MODE !== 'false'

function withSqliteHardening(url: string): string {
  const [base, query = ''] = url.split('?')
  const params = new URLSearchParams(query)
  if (!params.has('connection_limit')) params.set('connection_limit', '1')
  return `${base}?${params.toString()}`
}

const prismaClientSingleton = () => {
  const databaseUrl = withSqliteHardening(process.env.DATABASE_URL ?? 'file:./prisma/dev.db')
  const baseClient = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

  // Enable WAL mode and a busy timeout on the single shared connection.
  // WAL lets readers and the writer operate concurrently without blocking each
  // other, and busy_timeout makes writers wait briefly instead of failing
  // instantly with "database is locked" during rare contention (e.g. `prisma
  // migrate deploy` or the `sqlite3` CLI touching the file at the same time).
  // Both PRAGMAs return a result row, so SQLite rejects them via $executeRawUnsafe
  // ("Execute returned results, which is not allowed in SQLite") - use $queryRawUnsafe instead.
  //
  // journal_mode is persisted inside the database file itself, not just for the
  // current connection. Once a file has been switched to WAL it stays in WAL
  // forever until something explicitly switches it back - so the "false" branch
  // must actively set journal_mode=DELETE, otherwise the -wal/-shm files keep
  // reappearing from a previous run even with SQLITE_WAL_MODE=false.
  // Reported once per process, and only at debug level. The journal mode is a fixed property
  // of the setup - repeating it on every request says nothing new, and in development the dev
  // server builds several module graphs, so this ran again for each of them. A failure still
  // warns every time, because that is the case worth noticing.
  const announce = (message: string) => {
    if (globalThis.prismaJournalModeLogged) return
    globalThis.prismaJournalModeLogged = true
    log.debug(message)
  }

  if (isWalModeEnabled) {
    baseClient.$queryRawUnsafe('PRAGMA journal_mode = WAL;')
      .then(() => announce('SQLite WAL mode enabled'))
      .catch((err) => log.warn('Failed to enable SQLite WAL mode', {}, wrapError(err)))
  } else {
    baseClient.$queryRawUnsafe('PRAGMA journal_mode = DELETE;')
      .then(() => announce('SQLite WAL mode disabled via SQLITE_WAL_MODE=false'))
      .catch((err) => log.warn('Failed to disable SQLite WAL mode', {}, wrapError(err)))
  }

  baseClient.$queryRawUnsafe(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS};`)
    .catch((err) => log.warn('Failed to set SQLite busy_timeout', {}, wrapError(err)))

  // ── Transparent SSO Secret Decryption ────────────────────────
  // SSO clientId/clientSecret and oidcConfig are stored encrypted in the DB.
  // This extension transparently decrypts them on read so that better-auth
  // and all other consumers get plaintext credentials without explicit calls.
  const client = baseClient.$extends({
    query: {
      ssoProvider: {
        async $allOperations({ args, query, operation }) {
          const result = await query(args);

          const readActions = ['findUnique', 'findFirst', 'findMany'];
          if (!readActions.includes(operation) || !result) return result;

          // Lazy import to avoid circular dependency (crypto.ts does not import prisma.ts)
          const { decrypt } = await import('./crypto');

          const decryptSsoRecord = (record: any) => {
            if (!record) return record;
            try {
              if (record.clientId) record.clientId = decrypt(record.clientId);
            } catch { /* Not encrypted or wrong key - return as-is */ }
            try {
              if (record.clientSecret) record.clientSecret = decrypt(record.clientSecret);
            } catch { /* Not encrypted or wrong key - return as-is */ }
            try {
              if (record.oidcConfig) {
                const parsed = JSON.parse(record.oidcConfig);
                let changed = false;
                if (parsed.clientId) { try { parsed.clientId = decrypt(parsed.clientId); changed = true; } catch {} }
                if (parsed.clientSecret) { try { parsed.clientSecret = decrypt(parsed.clientSecret); changed = true; } catch {} }
                if (changed) record.oidcConfig = JSON.stringify(parsed);
              }
            } catch { /* Parse error or not encrypted - return as-is */ }
            return record;
          };

          if (Array.isArray(result)) {
            return result.map(decryptSsoRecord);
          }
          return decryptSsoRecord(result);
        },
      },
    },
  });

  // ── Tenants ──────────────────────────────────────────────────
  // Every query on a tenant model is narrowed to the tenant of the code that runs now, see
  // src/lib/tenant/prisma-scope.ts. The request is asked lazily, it imports this client itself.
  // A read of more than 999 parents with an ordered relation breaks Prisma on SQLite, so it runs
  // in pages, see src/lib/prisma-paging.ts. Added last, it runs first and pages the read as asked.
  return client
    .$extends(tenantScopeExtension(async () => (await import('./tenant/current')).requestScope()))
    .$extends(relationOrderPaging);
}

declare global {
  var prisma: undefined | ReturnType<typeof prismaClientSingleton>
  /** Set once the journal mode has been reported, so repeated module loads stay quiet. */
  var prismaJournalModeLogged: undefined | boolean
}

const prisma = globalThis.prisma ?? prismaClientSingleton()

export default prisma

if (process.env.NODE_ENV !== 'production') globalThis.prisma = prisma
