# Redis Adapter Implementation Plan

## Übersicht

Dieses Dokument beschreibt den vollständigen Implementierungsplan für die Integration von **Redis** als unterstützte Datenbank in DBackup. Die Implementierung folgt den bestehenden Patterns und Konventionen der anderen Database-Adapter (MySQL, PostgreSQL, MongoDB, etc.).

---

## Technische Analyse

### Redis Backup-Mechanismen

Redis bietet mehrere Backup-Methoden:

| Methode | Beschreibung | Empfohlen |
|---------|--------------|-----------|
| **RDB Snapshot** | Point-in-time Snapshot (`BGSAVE`) | ✅ Ja |
| **AOF (Append Only File)** | Transaktionslog | ⚠️ Optional |
| **DUMP/RESTORE** | Key-by-Key Serialisierung | ❌ Zu langsam |
| **redis-cli --rdb** | Remote RDB Download | ✅ Ja (Primär) |

**Primäre Strategie**: `redis-cli --rdb <host> <filename>` zum Herunterladen eines RDB-Snapshots.

### Benötigte CLI-Tools

| Tool | Paket (Alpine) | Verwendung |
|------|----------------|------------|
| `redis-cli` | `redis` | Connection Test, RDB Download, RESTORE |

### Besonderheiten von Redis

1. **Keine traditionellen "Databases"**: Redis nutzt nummerierte Databases (0-15 default)
2. **Cluster Mode**: Erfordert spezielle Behandlung (Multi-Shard)
3. **ACL (Access Control)**: Ab Redis 6+ mit Benutzer/Passwort
4. **Sentinel**: High-Availability Setup erfordert Sentinel-Discovery

---

## Implementierungsplan

### Phase 1: Foundation & Schema (Priorität: Hoch)

#### TODO 1.1: Zod Configuration Schema

**Datei:** `src/lib/adapters/definitions.ts`

```typescript
export const RedisSchema = z.object({
    // Connection Mode
    mode: z.enum(["standalone", "sentinel", "cluster"]).default("standalone"),

    // Standalone / Sentinel Node
    host: z.string().default("localhost"),
    port: z.coerce.number().default(6379),

    // Authentication (Redis 6+ ACL)
    username: z.string().optional().describe("Username (Redis 6+ ACL, leave empty for default)"),
    password: z.string().optional(),

    // Database Selection (0-15)
    database: z.coerce.number().min(0).max(15).default(0).describe("Database index (0-15)"),

    // TLS/SSL
    tls: z.boolean().default(false).describe("Enable TLS/SSL connection"),

    // Sentinel specific
    sentinelMasterName: z.string().optional().describe("Master name for Sentinel mode"),
    sentinelNodes: z.string().optional().describe("Comma-separated sentinel nodes (host:port)"),

    // Cluster specific (Future)
    // clusterNodes: z.string().optional(),

    // Backup Options
    backupMethod: z.enum(["rdb"]).default("rdb").describe("Backup method (RDB snapshot)"),

    // Additional options
    options: z.string().optional().describe("Additional redis-cli options"),
});
```

**Aufgaben:**
- [ ] Schema in `definitions.ts` hinzufügen
- [ ] `ADAPTER_DEFINITIONS` Array aktualisieren
- [ ] Export sicherstellen

---

#### TODO 1.2: Adapter Ordnerstruktur

**Pfad:** `src/lib/adapters/database/redis/`

```
redis/
├── index.ts          # Adapter Export & Registration
├── connection.ts     # test(), getDatabases()
├── dump.ts           # dump() - RDB Snapshot
├── restore.ts        # restore(), prepareRestore()
├── analyze.ts        # analyzeDump() - RDB Parsing (optional)
└── dialects/
    └── index.ts      # Version-specific handling (falls nötig)
    └── redis-base.ts # Base dialect implementation
```

**Aufgaben:**
- [ ] Ordner `src/lib/adapters/database/redis/` erstellen
- [ ] Alle Dateien mit Grundstruktur anlegen

---

### Phase 2: Core Adapter Implementation (Priorität: Hoch)

#### TODO 2.1: Connection Module (`connection.ts`)

```typescript
// src/lib/adapters/database/redis/connection.ts

export async function test(config: any): Promise<{ success: boolean; message: string; version?: string }> {
    // 1. Parse config with RedisSchema
    // 2. Build redis-cli args
    // 3. Execute: redis-cli -h <host> -p <port> [-a <password>] PING
    // 4. Parse version: redis-cli INFO server | grep redis_version
    // 5. Return result
}

export async function getDatabases(config: any): Promise<string[]> {
    // Redis hat fixe DBs (0-15 by default)
    // 1. Execute: redis-cli CONFIG GET databases
    // 2. Return array: ["0", "1", ..., "15"]
    // Oder: Nur DBs mit Keys zurückgeben via DBSIZE check pro DB
}
```

**Aufgaben:**
- [ ] `test()` Funktion implementieren
- [ ] `getDatabases()` Funktion implementieren (listet alle nicht-leeren DBs)
- [ ] Passwort-Maskierung in Logs
- [ ] TLS Support via `--tls` Flag
- [ ] Sentinel Mode Discovery

---

#### TODO 2.2: Dump Module (`dump.ts`)

```typescript
// src/lib/adapters/database/redis/dump.ts

export async function dump(
    config: any,
    destinationPath: string,
    onLog?: LogCallback,
    onProgress?: ProgressCallback
): Promise<BackupResult> {
    // STRATEGIE 1: redis-cli --rdb (Preferred)
    // 1. Parse config
    // 2. Trigger BGSAVE: redis-cli BGSAVE
    // 3. Wait for completion: redis-cli LASTSAVE (poll until timestamp changes)
    // 4. Download RDB: redis-cli --rdb <destinationPath>
    // 5. Verify file size > 0

    // STRATEGIE 2 (Alternative): Direct RDB file copy (wenn lokal/SSH)
    // - Nur für lokale oder SSH-verbundene Redis-Server
}
```

**Implementierungsdetails:**
- `redis-cli --rdb` streamt das RDB-File direkt
- Progress: Polling via `LASTSAVE` Timestamp
- Multi-DB: Immer kompletter Server (alle DBs in einem RDB)

**Aufgaben:**
- [ ] RDB Download via `redis-cli --rdb` implementieren
- [ ] BGSAVE Trigger mit Polling
- [ ] Passwort-Handling (`-a` flag oder `REDISCLI_AUTH` env)
- [ ] TLS Support
- [ ] Logging Integration
- [ ] Error Handling (Connection refused, Auth failed, etc.)

---

#### TODO 2.3: Restore Module (`restore.ts`)

```typescript
// src/lib/adapters/database/redis/restore.ts

export async function prepareRestore(config: any, databases: string[]): Promise<void> {
    // 1. Check if Redis is accessible
    // 2. Check if user has permission to FLUSHALL (for full restore)
    // 3. Warn user: Restore will REPLACE ALL DATA
}

export async function restore(
    config: any,
    sourcePath: string,
    onLog?: LogCallback,
    onProgress?: ProgressCallback
): Promise<BackupResult> {
    // WICHTIG: Redis RDB Restore ist KOMPLEX
    //
    // Option A: Server-side RDB Replace (Recommended for production)
    // 1. Stop Redis Server
    // 2. Copy RDB file to Redis data directory
    // 3. Start Redis Server
    // → Erfordert SSH/Local Access oder Docker Volume
    //
    // Option B: FLUSHALL + Selective Restore (Langsamer, aber remote möglich)
    // 1. Parse RDB file with rdb-tools or similar
    // 2. Execute FLUSHALL
    // 3. Replay all keys via redis-cli pipe
    // → Package: rdb-tools (Python) oder redis-rdb-tools
    //
    // Option C: redis-cli with DEBUG RELOAD (dangerous, disabled by default)
    //
    // ERSTE IMPLEMENTIERUNG: Dokumentiere Limitierung
    // - Restore erfordert Server-Zugriff (SSH/Local)
}
```

**Aufgaben:**
- [ ] `prepareRestore()` mit Permission-Check
- [ ] Dokumentierte Limitierung für Remote Restore
- [ ] SSH-basierter Restore (falls mode="ssh")
- [ ] Local file restore für Docker-mounted volumes

---

#### TODO 2.4: Adapter Index (`index.ts`)

```typescript
// src/lib/adapters/database/redis/index.ts

import { DatabaseAdapter } from "@/lib/core/interfaces";
import { RedisSchema } from "@/lib/adapters/definitions";
import { dump } from "./dump";
import { restore, prepareRestore } from "./restore";
import { test, getDatabases } from "./connection";
import { analyzeDump } from "./analyze";

export const RedisAdapter: DatabaseAdapter = {
    id: "redis",
    type: "database",
    name: "Redis",
    configSchema: RedisSchema,
    dump,
    restore,
    prepareRestore,
    test,
    getDatabases,
    analyzeDump
};
```

**Aufgaben:**
- [ ] Adapter-Objekt erstellen
- [ ] In `src/lib/adapters/index.ts` registrieren

---

### Phase 3: Infrastructure & Docker (Priorität: Mittel)

#### TODO 3.1: Dockerfile Update

**Datei:** `Dockerfile`

```dockerfile
# Aktuelle apk install Zeile erweitern:
RUN echo 'http://dl-cdn.alpinelinux.org/alpine/v3.17/main' >> /etc/apk/repositories && \
    apk update && \
    apk add --no-cache \
    mysql-client \
    postgresql-client \
    postgresql14-client \
    postgresql16-client \
    mongodb-tools \
    redis \                    # <-- NEU: redis-cli
    openssl \
    zip \
    su-exec
```

**Aufgaben:**
- [ ] `redis` Package zu Dockerfile hinzufügen
- [ ] Build testen: `docker build -t dbm-test .`
- [ ] Verify: `docker run --rm dbm-test redis-cli --version`

---

#### TODO 3.2: Docker Compose Test Environment

**Datei:** `docker-compose.test.yml`

```yaml
# ==========================================
# Redis Family
# ==========================================

# Redis 6 (LTS with ACL support)
redis-6:
  image: redis:6-alpine
  container_name: dbm-test-redis-6
  command: redis-server --requirepass testpassword
  ports:
    - "63796:6379"
  healthcheck:
    test: ["CMD", "redis-cli", "-a", "testpassword", "ping"]
    interval: 5s
    timeout: 5s
    retries: 5

# Redis 7 (Current Stable)
redis-7:
  image: redis:7-alpine
  container_name: dbm-test-redis-7
  command: redis-server --requirepass testpassword
  ports:
    - "63797:6379"
  healthcheck:
    test: ["CMD", "redis-cli", "-a", "testpassword", "ping"]
    interval: 5s
    timeout: 5s
    retries: 5

# Redis 7 with TLS (Optional for TLS testing)
redis-7-tls:
  image: redis:7-alpine
  container_name: dbm-test-redis-7-tls
  # TLS config requires certificate generation
  # command: redis-server --tls-port 6379 --port 0 --tls-cert-file /certs/redis.crt ...
  ports:
    - "63798:6379"

# Redis Sentinel Setup (Optional, complex)
# redis-sentinel:
#   ...
```

**Aufgaben:**
- [ ] Redis 6 Container hinzufügen
- [ ] Redis 7 Container hinzufügen
- [ ] Test mit: `docker-compose -f docker-compose.test.yml up redis-6 redis-7 -d`
- [ ] Optional: TLS und Sentinel Container

---

#### TODO 3.3: Test Configuration

**Datei:** `tests/integration/test-configs.ts`

```typescript
// --- Redis ---
{
    name: 'Test Redis 6',
    config: {
        type: 'redis',
        host: TEST_HOST,
        port: 63796,
        password: 'testpassword',
        database: 0
    }
},
{
    name: 'Test Redis 7',
    config: {
        type: 'redis',
        host: TEST_HOST,
        port: 63797,
        password: 'testpassword',
        database: 0
    }
},
```

**Aufgaben:**
- [ ] Test-Konfigurationen hinzufügen
- [ ] Integration Tests anpassen (falls Redis-spezifische Logik nötig)

---

### Phase 4: Testing (Priorität: Hoch)

#### TODO 4.1: Unit Tests

**Datei:** `tests/unit/adapters/redis.test.ts`

```typescript
import { describe, it, expect, vi } from 'vitest';
import { RedisSchema } from '@/lib/adapters/definitions';

describe('Redis Adapter', () => {
    describe('Schema Validation', () => {
        it('should accept valid standalone config', () => {
            const config = {
                host: 'localhost',
                port: 6379,
                password: 'secret',
                database: 0
            };
            expect(() => RedisSchema.parse(config)).not.toThrow();
        });

        it('should reject invalid database number', () => {
            const config = {
                host: 'localhost',
                database: 20 // Invalid: max is 15
            };
            expect(() => RedisSchema.parse(config)).toThrow();
        });

        it('should default to standalone mode', () => {
            const result = RedisSchema.parse({ host: 'localhost' });
            expect(result.mode).toBe('standalone');
        });
    });

    describe('Connection', () => {
        // Mock tests for connection logic
    });

    describe('Dump', () => {
        // Mock tests for dump logic
    });
});
```

**Aufgaben:**
- [ ] Schema Validation Tests
- [ ] Connection Tests (mocked)
- [ ] Dump Tests (mocked)
- [ ] Restore Tests (mocked)

---

#### TODO 4.2: Integration Tests

**Datei:** `tests/integration/redis.test.ts` (oder in `backup.test.ts` integriert)

```typescript
describe('Redis Integration Tests', () => {
    it('should connect to Redis 6', async () => {
        const adapter = registry.get('redis') as DatabaseAdapter;
        const result = await adapter.test(testConfigs.redis6);
        expect(result.success).toBe(true);
    });

    it('should perform RDB backup', async () => {
        const adapter = registry.get('redis') as DatabaseAdapter;
        const dumpPath = path.join(tempDir, 'redis_backup.rdb');

        const result = await adapter.dump(testConfigs.redis7, dumpPath);

        expect(result.success).toBe(true);
        expect(fs.existsSync(dumpPath)).toBe(true);
        expect(fs.statSync(dumpPath).size).toBeGreaterThan(0);
    });
});
```

**Aufgaben:**
- [ ] Connection Tests für Redis 6 & 7
- [ ] Backup Test (RDB download)
- [ ] Restore Test (wenn implementiert)
- [ ] Multi-DB Test (optional)

---

### Phase 5: Documentation (Priorität: Mittel)

#### TODO 5.1: Developer Guide Update

**Datei:** `wiki/developer-guide/adapters/database.md`

Hinzufügen:

```markdown
## Redis Adapter

### Configuration Schema

\`\`\`typescript
const RedisSchema = z.object({
    mode: z.enum(["standalone", "sentinel", "cluster"]).default("standalone"),
    host: z.string().default("localhost"),
    port: z.coerce.number().default(6379),
    username: z.string().optional(),
    password: z.string().optional(),
    database: z.coerce.number().min(0).max(15).default(0),
    tls: z.boolean().default(false),
    sentinelMasterName: z.string().optional(),
    backupMethod: z.enum(["rdb"]).default("rdb"),
});
\`\`\`

### Backup Method

Redis backups use the **RDB snapshot** method via \`redis-cli --rdb\`:

\`\`\`bash
# Trigger background save
redis-cli -h <host> -p <port> -a <password> BGSAVE

# Download RDB file
redis-cli -h <host> -p <port> -a <password> --rdb backup.rdb
\`\`\`

### Limitations

- **Full Server Backup**: RDB contains ALL databases (0-15)
- **Restore Requires Access**: Direct file replacement needs server filesystem access
- **Cluster Mode**: Not yet supported (planned for future release)
```

**Aufgaben:**
- [ ] Database Adapter Docs aktualisieren
- [ ] Supported Versions Table aktualisieren
- [ ] Changelog Entry

---

#### TODO 5.2: User Guide

**Datei:** `wiki/user-guide/sources.md` (falls vorhanden)

- [ ] Redis als unterstützte Quelle dokumentieren
- [ ] Konfigurationsoptionen erklären
- [ ] Limitierungen erwähnen (Cluster, Restore)

---

### Phase 6: UI Integration (Priorität: Niedrig)

#### TODO 6.1: Source Form Icon

**Aufgabe:** Redis-Icon zur UI hinzufügen

- [ ] Icon in `public/` oder Icon-Library (Lucide, etc.) identifizieren
- [ ] In Source-Auswahl integrieren (automatisch via `ADAPTER_DEFINITIONS`)

#### TODO 6.2: Database Selection

**Besonderheit:** Redis hat nummerierte DBs (0-15)

- [ ] UI zeigt Dropdown mit DB-Nummern statt Namen
- [ ] "Alle Datenbanken" = Kompletter RDB Snapshot

---

## Implementierungs-Reihenfolge (Empfohlen)

| Schritt | Aufgabe | Geschätzte Zeit |
|---------|---------|-----------------|
| 1 | Schema Definition (`definitions.ts`) | 30 min |
| 2 | Dockerfile Update (`redis` package) | 15 min |
| 3 | Docker Compose Test Containers | 30 min |
| 4 | Adapter Ordner + Index erstellen | 15 min |
| 5 | `connection.ts` (test, getDatabases) | 1-2 Std |
| 6 | `dump.ts` (RDB Download) | 2-3 Std |
| 7 | Adapter Registration | 15 min |
| 8 | Unit Tests | 1-2 Std |
| 9 | Integration Tests | 1-2 Std |
| 10 | `restore.ts` (Basis-Implementierung) | 2-3 Std |
| 11 | Documentation | 1 Std |
| 12 | UI Polish (Icons, Labels) | 30 min |

**Gesamt: ~12-16 Stunden Entwicklungszeit**

---

## Bekannte Limitierungen (V1)

1. **Kein Cluster-Support**: Nur Standalone und Sentinel Mode
2. **Remote Restore limitiert**: Erfordert Server-Filesystem-Zugriff
3. **Keine selektive DB-Wiederherstellung**: RDB enthält immer alle DBs
4. **AOF nicht unterstützt**: Nur RDB Snapshots

---

## Future Enhancements (V2+)

- [ ] Redis Cluster Support
- [ ] AOF Backup Option
- [ ] Selective Database Restore via RDB Parsing
- [ ] Redis Streams Backup
- [ ] Memory Analysis Tools

---

## Referenzen

- [Redis Persistence Documentation](https://redis.io/docs/management/persistence/)
- [redis-cli Manual](https://redis.io/docs/ui/cli/)
- [Redis Security (ACL)](https://redis.io/docs/management/security/acl/)
- [MongoDB Adapter (Referenz-Implementierung)](../src/lib/adapters/database/mongodb/)

---

## Checklist Summary

### Phase 1: Foundation ✅ DONE
- [x] `RedisSchema` in `definitions.ts`
- [x] Adapter folder structure
- [x] `connection.ts` - test(), getDatabases()
- [x] `dump.ts` - RDB snapshot download
- [x] `restore.ts` - prepareRestore(), restore()
- [x] `index.ts` - Adapter export
- [x] Register in `src/lib/adapters/index.ts`

### Phase 2: Infrastructure ✅ DONE
- [x] Dockerfile: Add `redis` package
- [x] docker-compose.test.yml: Redis 6/7 containers
- [x] test-configs.ts: Redis test entries

### Phase 3: Testing ✅ DONE
- [x] Unit tests: Schema validation (10 tests in definitions.test.ts)
- [x] Integration tests: Configured in test-configs.ts (runs with backup.test.ts)

### Phase 4: Documentation ✅ DONE
- [x] wiki/developer-guide/adapters/database.md - Redis section added
- [x] Changelog entry - v0.9.3-beta

### Phase 5: UI ✅ DONE
- [x] Redis icon - Added to `getAdapterIcon()` in utils.ts
- [x] Adapter summary - Shows `host:port (DB X)` format
- [x] Database number field - Automatically handled by schema (number input 0-15)
