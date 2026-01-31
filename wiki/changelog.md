# Changelog

Alle bemerkenswerten Änderungen an DBackup werden hier dokumentiert.

## v0.9.0-beta - Microsoft SQL Server & Self-Service Security
*Released: 31. Januar 2026*

Diese Version führt vollständige Unterstützung für Microsoft SQL Server (MSSQL) ein und bringt den Database Backup Manager in Enterprise Windows-Umgebungen. Zudem wurde ein dedizierter Self-Service Passwort-Änderungs-Flow für Benutzer hinzugefügt und die Anwendung mit neuen Stress-Testing-Tools gehärtet.

### ✨ Neue Features

#### 🏢 Microsoft SQL Server (MSSQL) Support
- **Native Adapter**: Vollständig ausgestatteter Adapter für Microsoft SQL Server
- **Smart Detection**: Automatische Erkennung der SQL Server Edition (z.B. Express, Enterprise) und Version für Feature-Kompatibilität
- **Multi-DB Support**: Unterstützt Backup mehrerer MSSQL-Datenbanken in einem Job durch Bündelung in ein TAR-Archiv
- **Server-Side Backups**: Optimiert für lokale Backup-Pfade auf dem SQL Server Host mit integrierter Kompressionsunterstützung
- **Security**: Implementierte parametrisierte Queries und strikte Timeout-Behandlung

#### 👤 User Self-Service
- **Password Change UI**: Benutzer können ihr Passwort direkt in den Profileinstellungen ändern
- **Audit Integration**: Das Audit-Log-System erkennt und taggt "self-service" Aktionen korrekt

### 🧪 Testing & Infrastruktur
- **Stress Testing**: Neuer Stress-Test-Datengenerator und npm-Scripts zur Simulation von hoher Last
- **Isolation**: Test-Suite refactored um dedizierte `testdb` Container zu verwenden
- **Cleanup**: Verbesserte temporäre Datei-Behandlung (`/tmp`) für MSSQL-Test-Backups

### 📚 Dokumentation
- **MSSQL Guide**: Umfassende Dokumentation zu MSSQL Editions, Server-Side-Backup-Berechtigungen und Deployment-Strategien
- **Meta-Backup**: Dokumentation zum internen Konfigurations-Backup-System finalisiert

---

## v0.8.3-beta - Meta-Backups & System Task Control
*Released: 30. Januar 2026*

Diese Version führt "Meta-Backups" ein – die Fähigkeit für den Database Backup Manager, seine eigene Konfiguration, Benutzer und Zustand zu sichern. Dies stellt sicher, dass deine Backup-Infrastruktur genauso resilient ist wie die Datenbanken, die sie schützt.

### ✨ Neue Features

#### 🛡️ Configuration "Meta-Backups"
- **Self-Backup**: Die Anwendung kann nun Backups ihrer eigenen internen Konfiguration erstellen, inklusive Benutzer, Jobs und Einstellungen
- **Storage Integration**: Konfigurations-Backups können zu bestehenden Storage-Adaptern geleitet werden
- **Disaster Recovery**: Vollständiger "System Config Restore" Flow zum Wiederherstellen des Anwendungszustands
- **Sanitization**: Benutzerkonten und sensible Daten werden während Export/Import sorgfältig behandelt

#### 🔑 Smart Encryption Recovery
- **Profile Portability**: Expliziter Export und Import von Encryption Profile Secret Keys für Server-Migration
- **Smart Detection**: Restore-Logik erkennt fehlende Encryption Profiles und handelt entsprechend
- **Nested Metadata**: Verbesserte Parsing-Logik für komplexe, verschachtelte Verschlüsselungs-Metadaten

#### ⚙️ System Task Management
- **Task Control**: Administratoren können Hintergrund-System-Tasks manuell aktivieren/deaktivieren
- **Unified Scheduling**: Konfigurations-Backup-Zeitplan in den Standard System Task Scheduler verschoben
- **Auto-Save**: Auto-Save-Funktionalität für die Configuration Backup Einstellungsseite

### 🐛 Fixes & Quality of Life
- Umfassende Dokumentation für Export/Import von Secrets und Disaster Recovery
- Metadata-Key-Konsistenz und Ordnerstruktur-Probleme behoben
- Neue Tests für AI-Transparenz, Scheduler-Logik und Config-Service Edge-Cases
- Manuellen Backup-Trigger aus UI entfernt zugunsten standardisierter System-Task-Controls

---

## v0.8.2-beta - Keycloak, Encryption Imports & Database Reset
*Released: 29. Januar 2026*

Diese Version führt native Keycloak OIDC Unterstützung ein, verbessert die Sicherheit von Authentifizierungs-Flows und fügt kritische Funktionalität für den Import von Encryption Profiles hinzu.

### ⚠️ BREAKING CHANGE: Database Reset Required

Die gesamte Datenbank-Schema-Historie wurde in eine einzige, saubere Initialisierungs-Migration konsolidiert.

- **Action Required**: Bestehende `dev.db` Datei muss gelöscht werden
- **Data Loss**: Bestehende Daten können nicht automatisch migriert werden

### ✨ Neue Features

#### 🔐 Keycloak & OIDC Security
- **Keycloak Adapter**: Dedizierter OIDC-Adapter und Icon speziell für Keycloak
- **Security Hardening**: OIDC-Client erzwingt HTTPS für Keycloak-Provider und lehnt Mixed-Content-Endpoints strikt ab
- **Discovery Headers**: Notwendige Headers für Keycloak OIDC Discovery Fetches

#### 🔑 Encryption & Recovery
- **Profile Import**: Import von Encryption Profiles direkt ins System für Disaster Recovery
- **Smart Restore**: Intelligente Handhabung von wiederhergestellten Profilen
- **Documentation**: Erweiterte Verschlüsselungs-Dokumentation und Recovery-Logs

#### 👤 Authentication UX
- **2-Step Login**: Login-Erfahrung refactored zu Email-First 2-Step-Flow
- **SSO Configuration**: SSO Provider Form in Tabs aufgeteilt für bessere Organisation

### 🐛 Fixes & Improvements
- "Edit" Buttons sind nun ghost-styled, Footer rechtsbündig
- Pagination-Problem behoben wenn Page-Count undefined war
- Neue Tests für Profile Imports und Smart Recovery Logik

---

## v0.8.1-beta - SQLite Support & Remote File Browsing
*Released: 26. Januar 2026*

Diese Version führt vollständige Unterstützung für SQLite-Datenbanken ein, inklusive einem leistungsstarken Feature zum Backup von Remote-SQLite-Dateien via SSH-Tunneling.

### ✨ Neue Features

#### 🗄️ SQLite Support (Local & SSH)
- **Native SQLite Adapter**: SQLite-Datenbanken als Backup-Quellen hinzufügen
- **Remote SSH Support**: Backup von SQLite-Dateien auf Remote-Servern durch SSH-Tunnel-Streaming
- **Safe Restore**: Automatische Bereinigung der alten Datenbankdatei vor Wiederherstellung

#### 📂 Remote File Browser
- **File Picker Dialog**: Neuer Modal-Dialog zum direkten Durchsuchen des Dateisystems
- **SSH Integration**: Browser funktioniert sowohl für lokales Server-Dateisystem als auch für verbundene Remote-SSH-Ziele
- **Smart Inputs**: File Browser in Adapter-Formulare integriert

### ⚡ Improvements
- **SFTP Authentication**: Spezifischer `authType` Selector im SFTP Storage Form für Unterscheidung zwischen Passwort und Private Key
- **Docker Compose**: Beispiel `docker-compose.yml` verwendet nun standardmässig das `beta` Image-Tag

### 📚 Dokumentation
- Umfassende Dokumentation und Deployment-Guides für den neuen SQLite Adapter
- Projekt-Dokumentationsstruktur refactored und reorganisiert

---

## v0.8.0-beta - The First Beta: SSO, Audit Logs & Cloud Storage
*Released: 25. Januar 2026*

Diese Version markiert die erste offizielle Beta des Database Backup Managers! 🚀 Ein massiver Sprung in Funktionalität und Stabilität mit Enterprise-Ready Features.

### ✨ Key New Features

#### 🔐 SSO & Identity Management
- **OIDC Support**: Vollständige Unterstützung für OpenID Connect Provider (getestet mit Authentik, PocketID, Generic)
- **Account Linking**: Bestehende Benutzer können SSO-Provider mit ihren Konten verknüpfen
- **Auto-Provisioning**: Optionale automatische Benutzererstellung bei erfolgreicher SSO-Anmeldung
- **Management UI**: Dedizierte Admin-Oberfläche zur Konfiguration von Providern, Domains und Discovery-Endpoints
- **Security**: Striktes Rate Limiting, Domain-Verifizierung und 2FA-Administrations-Controls

#### ☁️ Expanded Storage Options
- **S3 Support**: Native Unterstützung für AWS S3 und kompatible Provider (MinIO, R2, etc.)
- **SFTP Support**: Sicheres Auslagern von Backups auf Remote-Server via SFTP
- **Connection Testing**: "Test Connection" Button zur sofortigen Verifizierung von Credentials
- **Smart Cleanup**: Automatisches Löschen von zugehörigen Metadata-Sidecar-Dateien

#### 🛡️ Audit & Compliance
- **Comprehensive Audit Logs**: Tracking aller wichtigen Aktionen (User, Group, System, Adapter-Änderungen)
- **Detailed Tracking**: Logs beinhalten User IP, User Agent und spezifische Diffs der Änderungen
- **Retention Policy**: Konfigurierbare Aufbewahrungseinstellungen für Audit Logs
- **DataTables**: Neue standardisierte Tabellenansicht mit facettiertem Filtern und Suche

#### 💾 Database Engine Improvements
- **Dialect Detection**: Adapter erkennen automatisch die spezifische Version und den Dialekt
- **MariaDB Support**: Dedizierter Adapter und Dialect-Handling für MariaDB
- **PostgreSQL**: Verbesserte Restore-Logik überspringt System-Datenbanken
- **Security**: MySQL Adapter verwendet `MYSQL_PWD` Environment Variable

#### ⚙️ System & Core
- **Update Checker**: Integrierter Service zum Prüfen auf neue Anwendungsversionen
- **System Tasks**: "Run on Startup" Optionen für Wartungsaufgaben
- **Health Checks**: Visuelle Health-History-Grid und Badges für alle Adapter
- **Settings**: Auto-Save für System-Einstellungen implementiert

### 🧪 Testing & Stability
- Umfassende Unit- und Integration-Tests für Backup & Restore Pipelines, Storage Services, Notification Logic & Scheduler
- Strikte TypeScript-Matching in Restore-Services
- Verbesserte Docker-Komposition für Multi-Database-Test-Umgebungen

### 🐛 Bug Fixes & Refactoring
- Optimierte Log-Darstellung mit strukturierten Log-Einträgen
- Alle grossen Listen (Jobs, Users, History) zu `DataTable` Komponente migriert
- Session-Handling-Fehler bei hoher Last behoben
- Clipboard-Kopier-Fehlerbehandlung korrigiert
- Filename-Handling nach Entschlüsselung korrigiert

---

## v0.5.0-dev - RBAC System, Encryption Vault & Core Overhaul
*Released: 24. Januar 2026*

Diese Version repräsentiert einen massiven Meilenstein für den Database Backup Manager mit einem vollständigen Role-Based Access Control (RBAC) System.

### ✨ Neue Features

#### 🛡️ Granular RBAC System
- Einführung von User Groups & Permissions
- Volle Management-UI für Users und Groups
- Strikter Schutz für die `SuperAdmin` Gruppe (kann nicht gelöscht oder modifiziert werden)
- Granulare Permission-Checks für API-Endpoints und Dashboard-Pages

#### 🔐 Enhanced Security & Encryption
- **Recovery Kits**: Generierung und Download von Offline-Recovery-Kits für Notfall-Entschlüsselung
- **Master Key Reveal**: Neuer gesicherter UI-Dialog zum Anzeigen und Exportieren des Master Keys
- **Rate Limiting**: Rate Limiting auf API- und Authentifizierungs-Endpoints
- **MySQL Security**: Adapter verwendet `MYSQL_PWD` für sichere Passwort-Handhabung
- **2FA Administration**: Admins können 2FA für gesperrte Benutzer zurücksetzen

#### 🗜️ Compression Support
- Native Unterstützung für Backup-Kompression (UI und Pipelines)
- Kompressionsstatus-Spalten in Jobs- und Storage-Tabellen

#### 📊 Live Progress Tracking
- Echtzeit-Fortschritts-Updates für Backup- und Restore-Operationen
- Visuelles Feedback für Schritte mit "indeterminate" Progress-Bars

### ⚡ Architecture & Refactoring
- **Pipeline Pattern**: Job-Runner in modulares Pipeline-Pattern refactored
- **Service Layer**: Business-Logik in dedizierte Service-Schicht extrahiert
- **Job Queue**: Limit von 10 max gleichzeitigen Jobs
- **BigInt Support**: `Execution.size` zu BigInt migriert für grosse Backup-Dateien
- **Streaming**: MySQL und Postgres Adapter für bessere Streaming-Performance optimiert
- **Testing**: Vitest Setup und Unit-Tests für Storage Service und Adapter

### 🎨 UI/UX Improvements
- DataTables überall: Jobs, Configs, Logs und Dashboard-Listen standardisiert
- Loading Skeletons für flüssigere Seitenübergänge
- "Users" zu "Users & Groups" umbenannt
- Command-based Popovers statt Standard-Selects
- Überarbeitete "Recovery Kit" Card UI

### 🐛 Bug Fixes
- Download-Dateinamen nach Entschlüsselung korrigiert
- Session-Fehlerbehandlung und Middleware-Logik behoben
- Clipboard-Kopier-Fehlerbehandlung korrigiert
- Diverse TypeScript-Typ-Probleme behoben
- Postgres Adapter Robustheit verbessert

### 📚 Documentation & Misc
- GNU General Public License hinzugefügt
- README mit neuer Galerie und Feature-Listen aktualisiert
- Entwickler-Dokumentation für Core Systems und Database Adapter
- Projekt Coding Standards und Instruction Guidelines
