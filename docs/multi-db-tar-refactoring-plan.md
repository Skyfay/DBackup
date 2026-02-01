# Multi-DB Backup Refactoring: TAR-Archiv Konzept

> **Status:** In Bearbeitung (Phase 5 abgeschlossen)
> **Erstellt:** 2026-02-01
> **Ziel:** Einheitliches TAR-basiertes Multi-DB Backup/Restore für alle Datenbank-Adapter

---

## 📋 Zusammenfassung

Dieses Dokument beschreibt die Migration von adapter-spezifischen Multi-DB Backup-Formaten zu einem einheitlichen TAR-Archiv-Konzept. Das Ziel ist eine robustere, wartbarere und einheitlichere Lösung für Multi-Database Backups.

### Aktueller Zustand vs. Zielzustand

| Adapter | Aktuell | Neu |
|---------|---------|-----|
| **MySQL** | Single `.sql` mit `--databases` Flag + Stream-Filtering | 1 `.sql` pro DB → TAR |
| **PostgreSQL** | `pg_dumpall` (Plain SQL) oder Single-DB (`-Fc`) | 1 `.dump` (Custom) pro DB → TAR |
| **MongoDB** | `--archive` (nur 1 oder alle DBs) | 1 `.archive` pro DB → TAR |
| **MSSQL** | ✅ Bereits TAR-basiert | Keine Änderung nötig |
| **SQLite** | File-Copy (single DB) | Keine Änderung nötig |

---

## 🎯 Ziele

1. **Einheitliche Architektur** - Alle Adapter folgen dem gleichen Pattern
2. **Robustes Multi-DB Restore** - Kein fragiles Stream-Parsing mehr
3. **Selektiver Restore** - Einzelne DBs aus Multi-DB Backup extrahieren
4. **Optimale Formate** - PostgreSQL kann Custom Format (`-Fc`) für alle DBs nutzen
5. **Code-Reduktion** - Weniger Sonderfälle, einfachere Wartung

> ⚠️ **Breaking Change**: Da wir im Beta-Stadium sind, wird kein Legacy-Support implementiert. Alte Multi-DB Backups sind nach dieser Änderung nicht mehr kompatibel.

---

## 📁 Neues Backup-Format

### Struktur eines Multi-DB TAR-Archivs

```
backup_2026-02-01T12-00-00.tar
├── manifest.json           # Archiv-Metadaten
├── database1.sql           # MySQL: mysqldump Output
├── database2.dump          # PostgreSQL: pg_dump -Fc (Custom Format)
├── database3.archive       # MongoDB: mongodump --archive
└── ...
```

### manifest.json Schema

```typescript
interface TarManifest {
  version: 1;                          // Format-Version
  createdAt: string;                   // ISO 8601 Timestamp
  sourceType: string;                  // 'mysql' | 'postgresql' | 'mongodb' | etc.
  engineVersion?: string;              // z.B. "8.0.32"
  databases: {
    name: string;                      // Original DB-Name
    filename: string;                  // Dateiname im Archiv
    size: number;                      // Größe in Bytes (unkomprimiert)
    format: string;                    // 'sql' | 'custom' | 'archive' | 'bak'
  }[];
  totalSize: number;                   // Gesamtgröße aller Dumps
}
```

---

## 🔄 Phasen-Übersicht

| Phase | Beschreibung | Geschätzter Aufwand | Status |
|-------|--------------|---------------------|--------|
| **Phase 1** | Shared Utilities & Interfaces | 0.5 Tage | ✅ Abgeschlossen |
| **Phase 2** | MySQL/MariaDB Adapter | 0.5 Tage | ✅ Abgeschlossen |
| **Phase 3** | PostgreSQL Adapter | 0.5 Tage | ✅ Abgeschlossen |
| **Phase 4** | MongoDB Adapter | 0.5 Tage | ✅ Abgeschlossen |
| **Phase 5** | Integration & Testing | 1 Tag | ✅ Abgeschlossen |
| **Phase 6** | Code Cleanup | 0.5 Tage | ⏳ Ausstehend |
| **Phase 7** | Dokumentation | 0.5 Tage | ⏳ Ausstehend |

**Gesamt: ~4 Tage**

---

## 📝 Phase 1: Shared Utilities & Interfaces

### 1.1 Neue Shared Module erstellen

**Datei:** `src/lib/adapters/database/common/tar-utils.ts`

```typescript
// Utilities für TAR-Archiv Erstellung und Extraktion
export async function createMultiDbTar(
  files: { name: string; path: string }[],
  manifest: TarManifest,
  destinationPath: string
): Promise<void>;

export async function extractMultiDbTar(
  sourcePath: string,
  extractDir: string
): Promise<{ manifest: TarManifest; files: string[] }>;

export async function isMultiDbTar(filePath: string): Promise<boolean>;

export async function readTarManifest(filePath: string): Promise<TarManifest | null>;
```

**Datei:** `src/lib/adapters/database/common/types.ts`

```typescript
export interface TarManifest {
  version: 1;
  createdAt: string;
  sourceType: string;
  engineVersion?: string;
  databases: DatabaseEntry[];
  totalSize: number;
}

export interface DatabaseEntry {
  name: string;
  filename: string;
  size: number;
  format: 'sql' | 'custom' | 'archive' | 'bak';
}
```

### 1.2 Interface-Erweiterung

**Datei:** `src/lib/core/interfaces.ts` (erweitern)

```typescript
export interface BackupMetadata {
  version: 1;
  // ... existing fields ...
  multiDb?: {
    format: 'tar';
    databases: string[];
  };
}
```

### TODOs Phase 1

- [x] `src/lib/adapters/database/common/tar-utils.ts` erstellen
- [x] `src/lib/adapters/database/common/types.ts` erstellen
- [x] `src/lib/core/interfaces.ts` - `BackupMetadata` erweitern
- [x] Unit Tests für TAR-Utils schreiben (18 Tests)

---

## 📝 Phase 2: MySQL/MariaDB Adapter

### 2.1 Dump-Logik ändern

**Datei:** `src/lib/adapters/database/mysql/dump.ts`

**Aktuell:**
```typescript
// Nutzt mysqldump --databases db1 db2 → Single .sql file
```

**Neu:**
```typescript
// Multi-DB: Für jede DB einzeln dumpen
if (dbs.length > 1) {
  const tempDir = await createTempDir();
  const dbFiles: { name: string; path: string }[] = [];

  for (const db of dbs) {
    const dbPath = path.join(tempDir, `${db}.sql`);
    await dumpSingleDatabase(config, db, dbPath, log);
    dbFiles.push({ name: `${db}.sql`, path: dbPath });
  }

  // Create TAR archive
  const manifest = createManifest('mysql', config.detectedVersion, dbFiles);
  await createMultiDbTar(dbFiles, manifest, destinationPath);

  // Cleanup temp files
  await cleanupTempDir(tempDir);
} else {
  // Single DB: Direct dump (unchanged)
  await dumpSingleDatabase(config, dbs[0], destinationPath, log);
}
```

### 2.2 Restore-Logik vereinfachen

**Datei:** `src/lib/adapters/database/mysql/restore.ts`

**Entfernen:**
- Komplexe `Transform` Stream für `USE` Statement Filtering
- `skipCurrentSection` Logic
- Buffer-basiertes Line-by-Line Parsing

**Neu:**
```typescript
// Check if TAR archive
if (await isMultiDbTar(sourcePath)) {
  const { manifest, files } = await extractMultiDbTar(sourcePath, tempDir);

  for (const dbEntry of manifest.databases) {
    const dbFile = files.find(f => f.endsWith(dbEntry.filename));
    const targetDb = getTargetDbName(dbEntry.name, dbMapping);

    if (shouldRestore(dbEntry.name, dbMapping)) {
      await ensureDatabase(config, targetDb, ...);
      await restoreSingleDatabase(config, targetDb, dbFile, log);
    }
  }
} else {
  // Single-DB backup (no TAR needed)
  await restoreSingleDatabase(config, sourcePath, dbMapping, log);
}
```

### TODOs Phase 2

- [x] `dump.ts` - `dumpSingleDatabase()` Helper extrahieren
- [x] `dump.ts` - Multi-DB TAR-Erstellung implementieren
- [x] `restore.ts` - TAR-Extraktion & Loop-Restore implementieren
- [x] `restore.ts` - Alten Multi-DB Stream-Code entfernen
- [x] `analyze.ts` - TAR-Support für DB-Analyse hinzufügen
- [ ] Integration Tests für MySQL Multi-DB

---

## 📝 Phase 3: PostgreSQL Adapter

### 3.1 Dump-Logik ändern

**Datei:** `src/lib/adapters/database/postgres/dump.ts`

**Aktuell:**
```typescript
// Single DB: pg_dump -Fc (Custom Format) ✅
// Multi-DB: pg_dumpall (Plain SQL) ❌
```

**Neu:**
```typescript
// Multi-DB: Jede DB einzeln mit pg_dump -Fc
if (dbs.length > 1) {
  const tempDir = await createTempDir();
  const dbFiles: { name: string; path: string }[] = [];

  for (const db of dbs) {
    const dbPath = path.join(tempDir, `${db}.dump`);
    // Use pg_dump -Fc for EACH database (optimal format)
    await dumpSingleDatabase(config, db, dbPath, 'custom', log);
    dbFiles.push({ name: `${db}.dump`, path: dbPath });
  }

  const manifest = createManifest('postgresql', config.detectedVersion, dbFiles);
  await createMultiDbTar(dbFiles, manifest, destinationPath);
  await cleanupTempDir(tempDir);
} else {
  // Single DB: Direct pg_dump -Fc (unchanged)
  await dumpSingleDatabase(config, dbs[0], destinationPath, 'custom', log);
}
```

### 3.2 Restore-Logik vereinfachen

**Datei:** `src/lib/adapters/database/postgres/restore.ts`

**Entfernen:**
- `isCustomFormat()` Check für Multi-DB Rejection
- Komplexes `\connect` Statement Parsing
- `CREATE DATABASE` Filtering
- ~200 Zeilen Transform-Stream Code

**Neu:**
```typescript
// Check if TAR archive
if (await isMultiDbTar(sourcePath)) {
  const { manifest, files } = await extractMultiDbTar(sourcePath, tempDir);

  for (const dbEntry of manifest.databases) {
    const dbFile = files.find(f => f.endsWith(dbEntry.filename));
    const targetDb = getTargetDbName(dbEntry.name, dbMapping);

    if (shouldRestore(dbEntry.name, dbMapping)) {
      await ensureDatabase(config, targetDb, ...);
      // pg_restore -Fc works for EVERY db now!
      await restoreSingleDatabase(config, targetDb, dbFile, log);
    }
  }
} else {
  // Single Custom Format backup (pg_restore)
  await restoreCustomFormat(config, sourcePath, dbMapping, log);
}
```

### 3.3 Vorteile für PostgreSQL

| Vorher | Nachher |
|--------|---------|
| Multi-DB = Plain SQL (unkomprimiert) | Multi-DB = Custom Format pro DB (komprimiert) |
| Custom Format nur für Single-DB | Custom Format für ALLE Backups |
| Komplexes `\connect` Parsing | Einfaches Loop-Restore |
| ~400 LOC für Restore | ~150 LOC für Restore |

### TODOs Phase 3

- [x] `dump.ts` - Multi-DB mit `pg_dump -Fc` pro DB implementieren
- [x] `dump.ts` - `pg_dumpall` Code komplett entfernen
- [x] `restore.ts` - TAR-basiertes Multi-DB Restore
- [x] `restore.ts` - Kompletten Plain-SQL Transform-Stream Code entfernen (592 → 279 LOC = -53%)
- [x] `analyze.ts` - TAR-Support hinzufügen
- [ ] Integration Tests für PostgreSQL Multi-DB

---

## 📝 Phase 4: MongoDB Adapter

### 4.1 Dump-Logik ändern

**Datei:** `src/lib/adapters/database/mongodb/dump.ts`

**Aktuell:**
```typescript
// Warning: Multiple databases selected but mongodump archive only supports one or all
if (dbs.length > 1) {
  log(`Warning: ... Dumping '${dbs[0]}' only.`);
}
```

**Neu:**
```typescript
// Multi-DB: Separate mongodump per database
if (dbs.length > 1) {
  const tempDir = await createTempDir();
  const dbFiles: { name: string; path: string }[] = [];

  for (const db of dbs) {
    const dbPath = path.join(tempDir, `${db}.archive`);
    // mongodump --archive=/path --db=specific_db
    await dumpSingleDatabase(config, db, dbPath, log);
    dbFiles.push({ name: `${db}.archive`, path: dbPath });
  }

  const manifest = createManifest('mongodb', config.detectedVersion, dbFiles);
  await createMultiDbTar(dbFiles, manifest, destinationPath);
  await cleanupTempDir(tempDir);
} else {
  // Single DB or ALL: Direct archive
  await dumpSingleDatabase(config, dbs[0], destinationPath, log);
}
```

### 4.2 Restore-Logik

**Datei:** `src/lib/adapters/database/mongodb/restore.ts`

```typescript
if (await isMultiDbTar(sourcePath)) {
  const { manifest, files } = await extractMultiDbTar(sourcePath, tempDir);

  for (const dbEntry of manifest.databases) {
    const dbFile = files.find(f => f.endsWith(dbEntry.filename));
    const targetDb = getTargetDbName(dbEntry.name, dbMapping);

    if (shouldRestore(dbEntry.name, dbMapping)) {
      // mongorestore --archive=/path --nsFrom="originalDb.*" --nsTo="targetDb.*"
      await restoreSingleDatabase(config, dbEntry.name, targetDb, dbFile, log);
    }
  }
} else {
  // Single-DB archive restore
  await restoreSingleDatabase(config, sourcePath, log);
}
```

### TODOs Phase 4

- [x] `dump.ts` - Multi-DB mit separatem `mongodump` pro DB (82 → 192 LOC)
- [x] `dump.ts` - Warning entfernen (jetzt supported!)
- [x] `restore.ts` - TAR-basiertes Multi-DB Restore (98 → 256 LOC)
- [x] `restore.ts` - `--nsFrom/--nsTo` für DB-Renaming
- [x] `analyze.ts` - Neue Datei für TAR-Manifest Analyse (23 LOC)
- [ ] Integration Tests für MongoDB Multi-DB

---

## 📝 Phase 5: Integration & Testing

### 5.1 Runner Pipeline anpassen

**Datei:** `src/lib/runner/steps/02-dump.ts`

- Sicherstellen, dass TAR-Output korrekt durch Compression/Encryption Pipeline geht
- Metadata-Update für `multiDb.format: 'tar'`

### 5.2 Restore Service anpassen

**Datei:** `src/services/restore-service.ts`

- TAR-Erkennung vor Decryption/Decompression
- Manifest-Extraktion für UI (zeigt enthaltene DBs)

### 5.3 UI Anpassungen

**Datei:** `src/components/restore/restore-dialog.tsx` (falls vorhanden)

- Manifest anzeigen: "Dieses Backup enthält 3 Datenbanken: db1, db2, db3"
- Selective Restore UI (Checkboxen pro DB)

### 5.4 Testmatrix

| Szenario | MySQL | PostgreSQL | MongoDB | MSSQL |
|----------|-------|------------|---------|-------|
| Single DB Backup | ✅ | ✅ | ✅ | ✅ |
| Multi-DB Backup (TAR) | 🆕 | 🆕 | 🆕 | ✅ |
| Multi-DB Restore (all) | 🆕 | 🆕 | 🆕 | ✅ |
| Multi-DB Restore (selective) | 🆕 | 🆕 | 🆕 | ✅ |
| DB Renaming | 🆕 | 🆕 | 🆕 | ✅ |
| With Compression | ✅ | ✅ | ✅ | ✅ |
| With Encryption | ✅ | ✅ | ✅ | ✅ |

### TODOs Phase 5

- [x] `02-dump.ts` - TAR-Support validieren, Multi-DB Metadata erkennen
- [x] `03-upload.ts` - `multiDb` Feld in Metadata schreiben
- [x] `restore-service.ts` - Manifest-Extraktion und Logging
- [ ] UI - Backup-Inhalt Anzeige (optional, später)
- [ ] Integration Tests: MySQL → TAR → Restore (manuell testen)
- [ ] Integration Tests: PostgreSQL → TAR → Restore (manuell testen)
- [ ] Integration Tests: MongoDB → TAR → Restore (manuell testen)
- [ ] Integration Tests: Compression + TAR
- [ ] Integration Tests: Encryption + TAR

---

## 📝 Phase 6: Code Cleanup

### 6.1 Code Entfernen

**MySQL `restore.ts`:**
- [ ] `Transform` Stream mit `USE` Parsing entfernen (~80 LOC)
- [ ] `skipCurrentSection` Logic entfernen
- [ ] Buffer-basiertes Processing entfernen

**PostgreSQL `dump.ts`:**
- [ ] `pg_dumpall` Pfad für neue Backups entfernen
- [ ] Multi-DB Plain SQL Branch entfernen (~30 LOC)

**PostgreSQL `restore.ts`:**
- [ ] `\connect` Parsing Transform Stream entfernen (~150 LOC)
- [ ] `CREATE DATABASE` Filtering entfernen
- [ ] System-DB Filtering (`template0`, etc.) entfernen
- [ ] Multi-DB Custom Format Rejection entfernen

**MongoDB `dump.ts`:**
- [ ] Warning für Multi-DB entfernen
- [ ] `targetDbs = [dbs[0]]` Workaround entfernen

### 6.2 Code-Reduktion Schätzung

| Adapter | Vorher (LOC) | Nachher (LOC) | Reduktion |
|---------|--------------|---------------|-----------|
| MySQL restore.ts | ~213 | ~150 | -30% |
| PostgreSQL dump.ts | ~120 | ~100 | -17% |
| PostgreSQL restore.ts | ~592 | ~300 | **-49%** |
| MongoDB dump.ts | ~80 | ~90 | +12% (mehr Features) |
| **Gesamt** | ~1005 | ~640 | **~36% weniger** |

### TODOs Phase 6

- [ ] MySQL: Transform Stream Code komplett entfernen
- [ ] PostgreSQL: pg_dumpall Code komplett entfernen
- [ ] PostgreSQL: Plain-SQL Transform Stream komplett entfernen
- [ ] MongoDB: Workarounds entfernen
- [ ] Code Review: Alle Adapter auf toten Code prüfen
- [ ] Unused Imports/Dependencies entfernen

---

## 📝 Phase 7: Dokumentation

### 7.1 Wiki Updates

**Datei:** `wiki/developer-guide/adapters/database.md`

- [ ] Neues TAR-Format dokumentieren
- [ ] `TarManifest` Interface beschreiben
- [ ] Migration Guide für Custom Adapter

**Datei:** `wiki/user-guide/features/restore.md`

- [ ] Multi-DB Restore Workflow aktualisieren
- [ ] Selective Restore Feature dokumentieren
- [ ] Screenshots aktualisieren (falls UI geändert)

**Datei:** `wiki/developer-guide/architecture.md`

- [ ] Backup-Format Sektion hinzufügen
- [ ] Diagramm für TAR-Pipeline

### 7.2 Neue Dokumentation

**Datei:** `wiki/developer-guide/core/backup-formats.md` (neu)

```markdown
# Backup Formats

## Multi-DB Backup Format
- TAR archive containing individual database dumps
- Manifest for metadata
- Supports selective restore

## Single-DB Backup Format
- Direct dump file (no TAR wrapper)
- MySQL: .sql
- PostgreSQL: .dump (Custom Format)
- MongoDB: .archive
- MSSQL: .bak
```

### 7.3 Changelog

**Datei:** `wiki/changelog.md`

```markdown
## [X.Y.0] - YYYY-MM-DD

### Changed
- **Multi-DB Backups**: Now use TAR archive format for all database types
- **PostgreSQL**: Multi-DB backups now use efficient Custom format per database
- **MongoDB**: True multi-database backup support (previously limited)

### Improved
- More reliable multi-database restore
- Selective restore: Choose specific databases from multi-DB backup
- ~36% code reduction in database adapter restore logic
```

### TODOs Phase 7

- [ ] `wiki/developer-guide/adapters/database.md` aktualisieren
- [ ] `wiki/user-guide/features/restore.md` aktualisieren
- [ ] `wiki/developer-guide/core/backup-formats.md` erstellen
- [ ] `wiki/changelog.md` Entry hinzufügen
- [ ] README.md aktualisieren (falls Feature erwähnt)
- [ ] `.github/copilot-instructions.md` aktualisieren

---

## 🧪 Testplan

### Unit Tests

```
tests/unit/adapters/database/common/
├── tar-utils.test.ts          # TAR create/extract/detect
└── manifest.test.ts           # Manifest validation

tests/unit/adapters/database/mysql/
└── dump.test.ts               # Multi-DB TAR creation

tests/unit/adapters/database/postgres/
└── dump.test.ts               # Multi-DB with pg_dump -Fc
```

### Integration Tests

```
tests/integration/
├── mysql-multi-db.test.ts     # Full cycle: dump → TAR → restore
├── postgres-multi-db.test.ts  # Full cycle with Custom format
├── mongodb-multi-db.test.ts   # Full cycle
└── selective-restore.test.ts  # Restore subset of DBs
```

---

## ⚠️ Risiken & Mitigationen

| Risiko | Wahrscheinlichkeit | Impact | Mitigation |
|--------|-------------------|--------|------------|
| TAR-Overhead bei kleinen DBs | Niedrig | Niedrig | Single-DB bleibt ohne TAR |
| Temp-Space bei großen Multi-DBs | Mittel | Mittel | Streaming wo möglich, Cleanup |
| Parallele Dump-Fehler | Niedrig | Mittel | Sequential Dump, robustes Error Handling |

---

## ✅ Akzeptanzkriterien

1. **Alle bestehenden Single-DB Tests grün**
2. **Neue Multi-DB Tests für MySQL, PostgreSQL, MongoDB**
3. **Performance: Nicht signifikant langsamer als vorher**
4. **Dokumentation vollständig aktualisiert**
5. **Alter Multi-DB Code komplett entfernt**

---

## 📊 Fortschritt

| Phase | Status | Notizen |
|-------|--------|---------|
| Phase 1: Shared Utilities | ✅ Abgeschlossen | 18 Unit Tests bestanden |
| Phase 2: MySQL Adapter | ✅ Abgeschlossen | Code -40% reduziert |
| Phase 3: PostgreSQL Adapter | ⬜ Nicht gestartet | |
| Phase 4: MongoDB Adapter | ⬜ Nicht gestartet | |
| Phase 5: Integration & Testing | ⬜ Nicht gestartet | |
| Phase 6: Code Cleanup | ⬜ Nicht gestartet | |
| Phase 7: Dokumentation | ⬜ Nicht gestartet | |

---

## 🔗 Referenzen

- [MSSQL TAR Implementation](../src/lib/adapters/database/mssql/dump.ts) - Bestehende Referenz
- [PostgreSQL restore.ts](../src/lib/adapters/database/postgres/restore.ts) - Zu vereinfachender Code
- [tar-stream npm](https://www.npmjs.com/package/tar-stream) - Verwendete Library
