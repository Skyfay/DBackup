# Security Audit Report 2.0

**Datum:** 24. Mai 2024
**Status:** In Review
**Auditor:** GitHub Copilot (DevSecOps)

## 1. Kritische Schwachstellen (High Risk)

### 1.1. Server-Side Request Forgery (SSRF) via DB Host
**Ort:** Datenbank-Verbindungsaufbau (`checkConnection`, Backup Jobs)
**Risiko:**
Ein Benutzer kann als `host` interne IP-Adressen (z.B. `127.0.0.1`, `169.254.169.254` für Cloud-Metadaten) oder lokale Dienste angeben.
Da der `mysqldump`/`pg_dump` Prozess vom Server ausgeführt wird, könnte ein Angreifer das Netzwerk scannen oder interne Dienste angreifen.
**Empfehlung:**
- Implementierung einer `Blocklist` für private IP-Ranges (RFC 1918), sofern nicht explizit erlaubt.
- Docker Network Isolation: Der Container sollte nur Zugriff auf konfigurierte Bridges haben.

### 1.2. Path Traversal bei Backup-Dateinamen
**Ort:** `Dump`-Service & `Storage`-Service
**Risiko:**
Wenn der Benutzer den Namen eines Backups oder Jobs beeinflussen kann, besteht die Gefahr, dass Dateien außerhalb des erlaubten `storage/`-Verzeichnisses geschrieben werden.
Beispiel Input: `../../../../etc/cron.d/malicious`
**Empfehlung:**
- Strenge Validierung aller Dateinamen mit `path.basename()`.
- Verwendung eines festen `safeJoin`-Utilitys, das sicherstellt, dass der resultierende Pfad *innerhalb* des `ROOT_BACKUP_DIR` liegt.

### 1.3 Man-in-the-Middle (MitM) durch "Disable SSL"
**Ort:** Neue MySQL/MariaDB Konfiguration
**Risiko:**
Die angefragte Funktion `disableSsl` erlaubt Verbindungen ohne Zertifikatsvalidierung.
**Empfehlung:**
- In der UI muss dies als **"Unsicher"** markiert werden (rotes Warnschild).
- Im Code muss sichergestellt werden, dass dies *niemals* der Default ist.

---

## 2. Mittlere Risiken (Medium Risk)

### 2.1. DoS durch "Zip Bomb" oder massive Logs
**Ort:** Restore-Funktion & Log-Dateien
**Risiko:**
Das System lädt SQL-Dumps oder Zip-Dateien hoch. Eine speziell präparierte Datei ("Zip Bomb") kann beim Entpacken den Speicher (RAM) oder die Festplatte (Disk usage) sprengen und den Server zum Absturz bringen.
**Empfehlung:**
- Limits für Dateigrößen in Nginx/Next.js Config.
- Stream-Verarbeitung statt Buffer im RAM (wird teilweise schon genutzt, muss aber für *alle* Adapter gelten).

### 2.2. Privilege Escalation via Docker Socket
**Ort:** `docker-compose.yml` (potenziell)
**Risiko:**
Falls die App in Zukunft Docker-Container steuern soll (z.B. um DBs zu stoppen) und der `/var/run/docker.sock` gemountet wird, ist das gleichbedeutend mit Root-Zugriff auf den Host.
**Empfehlung:**
- **Niemals** den Docker Socket mounten.
- App-Container sollte als `USER node` (nicht root) laufen (siehe Dockerfile-Check).

---

## 3. Architektur-Review & Best Practices

### 3.1. Authentication & Authorization (Better-Auth)
**Status:** ✅ Solide
- Die Trennung von `auth-client` und Server-Side `auth` ist korrekt.
- Middleware prüft Session-Existenz.
- **Zu prüfen:** Wird `checkPermission()` wirklich in *jeder* Server Action aufgerufen? (Automatischer Test empfohlen).

### 3.2. Secret Management
**Status:** ⚠️ Beobachtung
- Passwörter werden nun via Environment-Variablen an Adapter übergeben (`MYSQL_PWD`). Das ist gut.
- **Aber:** Bei MongoDB (`mongodump`) ist die Übergabe per CLI oft unumgänglich oder schwierig. Hier muss geprüft werden, ob die Prozess-Liste (`ps aux`) Passwörter leakt, während der Job läuft.

---

## 4. Action Plan (Sofortmaßnahmen)

1.  **Code-Check Adapter:** Sicherstellen, dass Argumente für `execFile` strikt typisiert sind (keine String-Konkatenation).
2.  **Path Sanitization Utility:** Erstellen einer zentralen Funktion `resolveSafePath(base, input)`, die überall genutzt wird, wo Dateien geschrieben/gelesen werden.
3.  **Permissions Audit:** Ein Skript schreiben, das alle `actions/*.ts` Dateien scannt und warnt, wenn `checkPermission` fehlt.
4.  **Network Policy:** Festlegen, ob der Docker-Container nach außen telefonieren darf (Egress Filtering).