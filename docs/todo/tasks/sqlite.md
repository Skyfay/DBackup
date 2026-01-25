# SQLite Adapter Implementation Plan

Ziel ist es, SQLite-Datenbanken zu sichern. Da SQLite serverlos ist, gibt es zwei Zugriffsarten:
1.  **Lokal**: Die Datenbankdatei liegt auf dem gleichen Server wie der Backup-Manager (oder in einem gemounteten Volume).
2.  **Remote (SSH)**: Die Datenbank liegt auf einem entfernten Linux/Windows Server. Der Zugriff erfolgt via SSH-Tunnel und Remote-Command-Execution.

## 1. Architektur & Strategie

### Backup-Strategie: Konsistenz ist Key
Einfaches Kopieren (`cp`) der `.sqlite` Datei ist **unsicher**, während die Datenbank von einer Applikation genutzt wird (WAL-Mode, Locking).
Daher nutzen wir das `sqlite3` CLI Tool:
- **Befehl**: `sqlite3 /path/to/db.sqlite ".dump"`
- **Format**: SQL-Textdump (Kompatibel mit anderen Adaptern, gut komprimierbar).
- **Fallback**: Falls `sqlite3` nicht verfügbar ist, könnte optional ein "Risky Copy" Modus angeboten werden (nicht empfohlen).

### SSH Integration
Wir nutzen bereits `ssh2-sftp-client` für SFTP Speicher. Für die **Ausführung** von `sqlite3` Befehlen auf dem Remote-System benötigen wir zusätzlich einen SSH Client, der Shell-Commands ausführen kann (z.B. `ssh2` oder `node-ssh`).

## 2. Datenstruktur & Konfiguration

Das Konfigurationsschema (`input`) im Adapter muss flexibel sein.

```typescript
const SQLiteSchema = z.object({
  mode: z.enum(["local", "ssh"]).default("local"),

  // Gemeinsame Felder
  path: z.string().min(1, "Database path is required"), // Absoluter Pfad zur .sqlite Datei
  sqliteBinaryPath: z.string().optional(), // Optional: Pfad zum binary (z.B. /usr/bin/sqlite3), default "sqlite3"

  // SSH spezifische Felder (nur wenn mode === 'ssh')
  host: z.string().optional(),
  port: z.coerce.number().default(22).optional(),
  username: z.string().optional(),
  authType: z.enum(["password", "privateKey", "agent"]).optional(),
  password: z.string().optional(), // Wird verschlüsselt
  privateKey: z.string().optional(), // Wird verschlüsselt
  passphrase: z.string().optional(), // Wird verschlüsselt
});
```

## 3. Implementierungs-Details

### A. Modus: Lokal
Nutzt `child_process.spawn` um `sqlite3` lokal auszuführen.

1.  **Test**: Prüfen ob Datei existiert (`fs.stat`) und ob `sqlite3 --version` läuft.
2.  **Dump**: `sqlite3 [path] .dump` -> `stdout` -> `Write Stream` in Zieldatei.
3.  **Restore**:
    - Prüfen, ob Zieldatei existiert.
    - Backup (Move) der existierenden Datei (Sicherheitsnetz).
    - `cat dump.sql | sqlite3 [path]` (via stdin Pipe).

### B. Modus: SSH (Remote)
Nutzt `ssh2` Client für Command execution.

1.  **Test**: SSH Verbindung aufbauen -> `stat [path]` -> `sqlite3 --version` prüfen.
2.  **Dump**:
    - SSH Exec: `sqlite3 [path] .dump`
    - Der Output Stream (`stdout`) des SSH Channels wird **direkt** in die lokale Zieldatei gepiped.
    - Kein temporäres File auf dem Remote-Server nötig!
3.  **Restore**:
    - Backup der Remote-Datei (via `mv` command oder `sftp` rename).
    - Lokales File lesen -> Pipe in SSH Exec (`sqlite3 [path]`).

## 4. Todo Liste (Schritt-für-Schritt)

### Phase 1: Vorbereitung
- [ ] **Dependencies prüfen**: `pnpm add ssh2 @types/ssh2` installieren (da `ssh2-sftp-client` nur SFTP kann, wir brauchen Shell-Access).
- [ ] **Interface**: Erstelle `src/lib/adapters/database/sqlite.ts`.

### Phase 2: Implementation (Core)
- [ ] **Schema Definition**: Zod Schema wie oben definiert implementieren.
- [ ] **Helper**: Klasse oder Funktionen für SSH Connection Management abstrahieren (vielleicht shared mit SFTP Storage?).
    - *Hinweis*: `ssh2-sftp-client` wrappt `ssh2`. Wir können eventuell den internen Client nutzen oder sauber getrennt implementieren.
- [ ] **Test-Methode (`test`)**:
    - Implementierung für Local (fs access).
    - Implementierung für SSH (Verbindungstest + File check).
- [ ] **GetDatabases (`getDatabases`)**:
    - Für SQLite nicht wirklich relevant, da 1 File = 1 DB.
    - Rückgabe: Einfach den Dateinamen (z.B. `["app.db"]`).

### Phase 3: Dump & Restore
- [ ] **Dump (Local)**:
    - Nutzung von `spawn`.
    - Error Handling (stderr parsing).
- [ ] **Dump (SSH)**:
    - SSH `exec` Stream handling.
    - Stream Backpressure beachten.
- [ ] **Restore (Local)**:
    - Sicherheitskopie der Zieldatei erstellen.
    - `sqlite3` mit Input-Stream füttern.
- [ ] **Restore (SSH)**:
    - Remote Sicherheitskopie.
    - Datenstrom über SSH senden.

### Phase 4: UI Anpassungen
- [ ] **Adapter Formular**: Das generische Formular sollte `z.discriminatedUnion` oder dynamische Sichtbarkeiten unterstützen (Wenn Mode=SSH, zeige Host/User fields).
    - *Check*: Unterstützt unser aktueller Formrenderer bedingte Felder? Falls nein, müssen wir entweder alle anzeigen (optional) oder den Renderer erweitern.

### Phase 5: Testing
- [ ] Unit Tests für Schema.
- [ ] Integration Tests (Mock SSH Server oder lokaler Container).
- [ ] Manuelles Testen mit einer Dummy-SQLite DB.

## 5. Offene Fragen / Risiken

- **SQLite Versionen**: Inkompatibilitäten zwischen Dump-Format und Ziel-SQLite-Version? (Meist ok bei SQL Dumps).
- **Windows Hosts (SSH)**: Pfad-Separatoren (`\` vs `/`). SSH Commands in Windows PowerShell vs CMD.
    - *Lösung*: Wir gehen vorerst von Linux/Unix Hosts aus. Windows-Support explizit als "Experimental" markieren oder Pfade strikt escapen.
