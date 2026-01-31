# MSSQL Adapter Implementation Plan

## 📋 Übersicht

Dieser Plan beschreibt die vollständige Implementierung eines Microsoft SQL Server (MSSQL) Adapters für den Database Backup Manager.

**Ziel**: Unterstützung von MSSQL Server 2017, 2019, 2022 (und Azure SQL Edge für ARM-Entwicklung).

---

## 🔍 Analyse

### 1. Verfügbare CLI-Tools

| Tool | Zweck | Verfügbarkeit |
|------|-------|---------------|
| `sqlcmd` | SQL-Befehle ausführen, Verbindungstest | mssql-tools18 (Linux/macOS) |
| `bcp` | Bulk-Import/Export (nicht für Schema) | mssql-tools18 |

**Problem**: Microsoft bietet **kein natives `mssqldump`-Tool** wie MySQL oder PostgreSQL!

### 2. Backup-Strategien für MSSQL

#### Option A: Native T-SQL BACKUP (Empfohlen für Self-Hosted)
```sql
BACKUP DATABASE [mydb] TO DISK = '/var/opt/mssql/backup/mydb.bak' WITH FORMAT, INIT;
```
- ✅ Vollständiges Backup inkl. Schema + Daten
- ✅ Inkrementelle/Differentielle Backups möglich
- ❌ Backup-Datei liegt auf dem **Server**, nicht lokal
- ❌ Erfordert Filesystem-Zugriff oder SMB-Share

#### Option B: `sqlcmd` + Schema-Scripting + BCP (Cross-Platform)
1. Schema exportieren via `sqlcmd` + `sp_helptext` / SMO-Scripts
2. Daten exportieren via `bcp` (Bulk Copy Program)
- ✅ Funktioniert remote
- ❌ Komplex, keine Single-File-Lösung
- ❌ Keine Transaktionskonsistenz garantiert

#### Option C: SQL Server Management Objects (SMO) via Node.js
- ❌ Erfordert .NET / PowerShell
- ❌ Nicht cross-platform kompatibel

#### **Gewählte Strategie: Option A (Native T-SQL BACKUP)**
- Für Self-Hosted MSSQL Server die robusteste Lösung
- Backup-Datei muss vom Server abgeholt werden (z.B. via SMB, SFTP, oder lokaler Mount)
- Alternativ: Azure Blob Storage als Backup-Ziel (für Azure SQL)

### 3. Restore-Strategie

```sql
RESTORE DATABASE [mydb] FROM DISK = '/var/opt/mssql/backup/mydb.bak' WITH REPLACE;
```
- Datei muss auf dem Server liegen
- Für Remote-Restore: Datei erst hochladen, dann RESTORE ausführen

### 4. Docker-Images für Testing

| Version | Image | Architektur | Port (Test) |
|---------|-------|-------------|-------------|
| 2017 | `mcr.microsoft.com/mssql/server:2017-latest` | amd64 only | 14337 |
| 2019 | `mcr.microsoft.com/mssql/server:2019-latest` | amd64 only | 14339 |
| 2022 | `mcr.microsoft.com/mssql/server:2022-latest` | amd64 only | 14342 |
| Edge | `mcr.microsoft.com/azure-sql-edge:latest` | amd64 + arm64 | 14350 |

> **Hinweis für M1/M2 Macs**: Nur Azure SQL Edge läuft nativ auf ARM. Andere Images benötigen Rosetta/QEMU.

### 5. Abhängigkeiten

```bash
# Node.js Package für MSSQL-Verbindungen
pnpm add mssql

# CLI-Tools (für Container/Host)
# Debian/Ubuntu:
curl https://packages.microsoft.com/keys/microsoft.asc | sudo apt-key add -
curl https://packages.microsoft.com/config/ubuntu/22.04/prod.list | sudo tee /etc/apt/sources.list.d/msprod.list
sudo apt-get update
sudo apt-get install mssql-tools18 unixodbc-dev

# macOS:
brew tap microsoft/mssql-release https://github.com/Microsoft/homebrew-mssql-release
brew install mssql-tools18
```

---

## 📁 Dateistruktur

```
src/lib/adapters/database/mssql/
├── index.ts                    # Adapter-Registrierung (DatabaseAdapter export)
├── connection.ts               # test(), getDatabases()
├── dump.ts                     # Backup via T-SQL BACKUP DATABASE
├── restore.ts                  # Restore via T-SQL RESTORE DATABASE
├── schema.ts                   # Zod-Schema für Konfiguration
└── dialects/
    ├── index.ts                # Dialect Factory
    ├── mssql-base.ts           # Base Dialect (2019+)
    └── mssql-2017.ts           # Legacy-spezifische Flags (falls nötig)
```

---

## ✅ Phasen-Roadmap

### Phase 1: Foundation (Basis-Infrastruktur) ✅ DONE
- [x] **1.1** Zod-Schema erstellen (`definitions.ts` - MSSQLSchema)
  - host, port (1433), user, password
  - database (single/multi)
  - encrypt (boolean, default: true für Azure)
  - trustServerCertificate (boolean, für Self-Signed)
  - backupPath (Server-seitiger Pfad für .bak Dateien)
- [x] **1.2** Adapter-Definition in `definitions.ts` hinzufügen
- [x] **1.3** Adapter in `src/lib/adapters/index.ts` registrieren
- [x] **1.4** Basis-Dateien erstellen:
  - `index.ts` - Adapter-Export
  - `connection.ts` - test(), getDatabases()
  - `dump.ts` - Backup-Logik
  - `restore.ts` - Restore-Logik
  - `analyze.ts` - Dump-Analyse (Stub)
  - `dialects/index.ts` - Dialect Factory
  - `dialects/mssql-base.ts` - SQL Server 2019+
  - `dialects/mssql-2017.ts` - SQL Server 2017
- [x] **1.5** Dependencies installieren (`mssql`, `@types/mssql`)

### Phase 2: Connection & Version Detection
- [x] **2.1** `connection.ts` implementieren
  - `test()`: Verbindung via `mssql` npm-Package testen
  - Version auslesen: `SELECT @@VERSION`
  - Version normalisieren: `"Microsoft SQL Server 2022 (RTM)..."` → `"16.0.1000"` (Major.Minor.Build)
- [x] **2.2** `getDatabases()` implementieren
  - Query: `SELECT name FROM sys.databases WHERE database_id > 4` (System-DBs ausschließen)
- [ ] **2.3** Unit Tests für Connection

### Phase 3: Dialects
- [x] **3.1** `mssql-base.ts` (Base Dialect)
  - `getBackupQuery(config, databases)`: T-SQL BACKUP-Statement generieren
  - `getRestoreQuery(config, backupPath, targetDb)`: T-SQL RESTORE-Statement
  - `getConnectionArgs(config)`: Für `sqlcmd` CLI (falls benötigt)
- [x] **3.2** `mssql-2017.ts` (Legacy Support, falls Unterschiede existieren)
- [x] **3.3** `index.ts` Dialect Factory
- [ ] **3.4** Unit Tests für Dialects

### Phase 4: Backup (dump.ts)
- [x] **4.1** Backup-Logik implementieren
  - Verbindung zu MSSQL aufbauen (mssql npm)
  - T-SQL `BACKUP DATABASE` ausführen
  - Progress-Tracking via `STATS = 10` Option (alle 10% ein Log)
- [x] **4.2** Multi-Database Support
  - Loop über alle ausgewählten DBs
  - Separate .bak Dateien oder kombiniertes Archiv
- [x] **4.3** Streaming/Download der .bak Datei
  - **Option A**: SMB/CIFS Share mounten
  - **Option B**: SQL Server `OPENROWSET(BULK...)` + BCP
  - **Option C**: Backup-Pfad = gemountetes Volume (Docker)
- [x] **4.4** Error Handling & Empty-Check
- [ ] **4.5** Integration mit Compression/Encryption Pipeline

### Phase 5: Restore (restore.ts)
- [x] **5.1** Restore-Logik implementieren
  - .bak Datei auf Server hochladen (via gemountetes Volume)
  - T-SQL `RESTORE DATABASE` ausführen
- [x] **5.2** Database Mapping (Rename bei Restore)
  - `WITH MOVE` Syntax für Dateiumbenennung
- [x] **5.3** Progress-Tracking
- [x] **5.4** prepareRestore() für Pre-Flight Checks
  - Ziel-DB existiert? Überschreiben erlaubt?
  - Versionskompatibilität prüfen

### Phase 6: Docker Test-Infrastruktur
- [ ] **6.1** `docker-compose.test.yml` erweitern
  ```yaml
  mssql-2019:
    image: mcr.microsoft.com/mssql/server:2019-latest
    platform: linux/amd64
    environment:
      - ACCEPT_EULA=Y
      - SA_PASSWORD=YourStrong!Passw0rd
      - MSSQL_PID=Express
    ports:
      - "14339:1433"
    volumes:
      - ./backups:/var/opt/mssql/backup
    healthcheck:
      test: /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "YourStrong!Passw0rd" -Q "SELECT 1" -C
      interval: 10s
      timeout: 5s
      retries: 10

  mssql-2022:
    image: mcr.microsoft.com/mssql/server:2022-latest
    platform: linux/amd64
    environment:
      - ACCEPT_EULA=Y
      - SA_PASSWORD=YourStrong!Passw0rd
      - MSSQL_PID=Express
    ports:
      - "14342:1433"
    volumes:
      - ./backups:/var/opt/mssql/backup
    healthcheck:
      test: /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "YourStrong!Passw0rd" -Q "SELECT 1" -C
      interval: 10s
      timeout: 5s
      retries: 10

  # Für ARM64 (M1/M2 Macs)
  mssql-edge:
    image: mcr.microsoft.com/azure-sql-edge:latest
    environment:
      - ACCEPT_EULA=Y
      - SA_PASSWORD=YourStrong!Passw0rd
    ports:
      - "14350:1433"
    volumes:
      - ./backups:/var/opt/mssql/backup
  ```
- [ ] **6.2** Test-Konfiguration in `tests/integration/test-configs.ts`
- [ ] **6.3** Seeding-Script erweitern (`scripts/seed-test-sources.ts`)

### Phase 7: Integration Tests
- [ ] **7.1** Connectivity Tests
  - Verbindung zu allen MSSQL-Versionen testen
  - Version Detection verifizieren
- [ ] **7.2** Backup Tests
  - Single-DB Backup
  - Multi-DB Backup
  - Backup mit Compression (native MSSQL Compression)
- [ ] **7.3** Restore Tests
  - Restore zu gleicher DB
  - Restore mit Rename
  - Version-Guard Test (neueres Backup → älterer Server)

### Phase 8: Unit Tests
- [ ] **8.1** `tests/unit/adapters/dialects/mssql.test.ts`
  - Dialect-Auswahl testen
  - SQL-Generierung verifizieren
  - Version-Parsing testen
- [ ] **8.2** Connection-Modul testen (Mocking)
- [ ] **8.3** Schema-Validierung testen

### Phase 9: Dockerfile & Dependencies
- [ ] **9.1** Dockerfile erweitern
  - `mssql-tools18` und `unixodbc` installieren
  - ODBC-Treiber konfigurieren
- [ ] **9.2** `package.json` Dependencies
  ```json
  "mssql": "^11.0.0"
  ```
- [ ] **9.3** Build verifizieren

### Phase 10: UI & Documentation
- [ ] **10.1** UI testen (Adapter-Form Rendering)
- [ ] **10.2** `README.md` aktualisieren (Supported Databases)
- [ ] **10.3** `docs/development/supported-database-versions.md` erweitern
- [ ] **10.4** Diese Datei als "Done" markieren

---

## ⚠️ Bekannte Einschränkungen

### 1. Backup-Datei-Transfer
MSSQL's `BACKUP DATABASE` schreibt auf das **Server-Filesystem**, nicht auf den Client.
**Lösung**:
- Docker: Shared Volume zwischen Container und Host
- Remote: SMB-Share oder manueller Download nach Backup

### 2. Azure SQL Database
Azure SQL unterstützt kein `BACKUP DATABASE`!
**Alternative**:
- Azure Blob Storage als Backup-Ziel (`BACKUP DATABASE ... TO URL`)
- Erfordert separate Azure-Credentials
- **Scope**: Außerhalb des initialen MVP, als Future Enhancement

### 3. Transaktionskonsistenz
- Native BACKUP ist transaktionskonsistent ✅
- BCP/Schema-Export ist **nicht** transaktionskonsistent ❌

### 4. ARM64 (Apple Silicon)
- MSSQL Server Images sind nur für amd64
- Für lokale Entwicklung auf M1/M2: Azure SQL Edge verwenden

---

## 📊 Risikobewertung

| Risiko | Wahrscheinlichkeit | Impact | Mitigation |
|--------|-------------------|--------|------------|
| Backup-Datei nicht abrufbar | Mittel | Hoch | Shared Volume, klare Dokumentation |
| sqlcmd nicht im Container | Niedrig | Mittel | Dockerfile-Check, `mssql` npm als Fallback |
| ARM64-Inkompatibilität | Hoch (für M1/M2 Devs) | Mittel | Azure SQL Edge als Alternative |
| Version-Parsing fehlschlägt | Niedrig | Niedrig | Regex-Fallback, manuelle Eingabe |

---

## 🔗 Referenzen

- [mssql npm Package](https://www.npmjs.com/package/mssql)
- [T-SQL BACKUP DATABASE](https://learn.microsoft.com/en-us/sql/t-sql/statements/backup-transact-sql)
- [T-SQL RESTORE DATABASE](https://learn.microsoft.com/en-us/sql/t-sql/statements/restore-statements-transact-sql)
- [Docker Hub: mssql/server](https://hub.docker.com/_/microsoft-mssql-server)
- [Azure SQL Edge](https://hub.docker.com/_/microsoft-azure-sql-edge)

---

## 📝 Changelog

| Datum | Änderung |
|-------|----------|
| 2026-01-31 | Initiale Analyse und Roadmap erstellt |
