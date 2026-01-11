# Projekt Status & ToDo (Stand: 11.01.2026)

## ✅ Erledigt

### 1. Projekt-Wiederherstellung & Netzwerk
- **Docker Netzwerk Vereinfachung:**
    - Statische IP-Adressen und das komplexe Custom-Network `networks` aus `docker-compose.yml` entfernt.
    - Wir nutzen nun das Standard-Docker-Bridge-Netzwerk und Hostnamen (`mysql`, `postgres`, etc.).
- **MySQL Kompatibilität:**
    - Image auf `mysql:8.0` fixiert (statt `latest`), um Inkompatibilitäten zu vermeiden.
    - Start-Command erweitert um `--default-authentication-plugin=mysql_native_password`, damit der Client sich verbinden kann.
- **Bugfixes:**
    - `src/server/database_setup.py`: Code hinzugefügt, um den fehlenden Ordner für `local.db` automatisch zu erstellen.
    - **Login:** Veraltete `generate_password_hash(method='sha256')` korrigiert. Login funktioniert nun wieder (`Admin` / `Password`).

### 2. Backup-Engine (Core)
- **Backup Framework Refactoring:**
    - Umstellung auf "Strategy Pattern" (Class-based).
    - Neue Struktur unter `src/server/backup/`:
        - `base.py`: Abstrakte Basisklasse.
        - `mysql.py`: MySQL Implementation.
        - `factory.py`: BackupFactory zur Auswahl der Strategie.
    - `src/server/backup_manager.py` entfernt.
- **Integration:**
    - Route `/test-backup` entfernt.
    - Neue Route `/backup/create/<db_id>` erstellt, die dynamisch die richtige Backup-Strategie wählt.

### 3. Vorbereitung der Tools
- **Dockerfile Update:**
    - Folgende Clients wurden im Image installiert:
        - `mariadb-client` (für `mysqldump`)
        - `postgresql-client` (für `pg_dump`)
        - `mongodb-tools` (für `mongodump`)

---

## 🚀 Nächste Schritte

### 1. UI Integration ("Backups" Seite)
- [ ] Die neue Backend-Logik (`create_backup_mysql`) mit der echten Datenbank-Liste im Dashboard verbinden.
- [ ] Seite `backups.html` erstellen/erweitern, um Backups manuell zu starten.
- [ ] Liste der vorhandenen Backup-Dateien im Frontend anzeigen.

### 2. Erweiterte Features
- [ ] **Komprimierung:** Dumps als `.zip` oder `.tar.gz` speichern (direkt nach dem Dump).
- [ ] **Verschlüsselung:** Optionales Encrypten der Archive.
- [ ] **Scheduler:** Einrichten eines Task-Schedulers (z.B. `APScheduler`) für automatische Cronjob-Backups.
- [ ] **Support für Postgres & Mongo:** Die existierenden Funktionen in `backup_manager.py` für die anderen DB-Typen erweitern.

### 3. Cleanup
- [ ] Die Test-Route `/test-backup` aus `src/app.py` wieder entfernen, sobald die echte UI steht.

---

## ℹ️ Quick Start für das nächste Mal

```bash
# Services starten
docker-compose up -d

# App öffnen
# http://localhost:5001

# Test-Backup auslösen (nur solange Test-Route existiert)
# http://localhost:5001/test-backup
```
