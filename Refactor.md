# Refactoring Roadmap & Optimierungen

Dieses Dokument dient als Roadmap für die technische Konsolidierung des Projekts. Das Ziel ist eine saubere Trennung von Verantwortlichkeiten (Separation of Concerns), bessere Testbarkeit und eine klarere Struktur für KI-Assistenten.

WICHTIG: Arbeite diese Punkte sequenziell ab. Markiere erledigte Punkte mit `[x]`.

## 1. Architektur: Service Layer einführen
**Status:** [x] Erledigt

**Problem:**
Aktuell vermischt sich Business-Logik (Datenbank-Updates, komplexe Validierungen) mit der Transport-Schicht (Server Actions) oder liegt in riesigen Utility-Files.

**Lösung:**
Einführung eines `src/services` Ordners. Server Actions (`src/app/actions`) sollen nur noch:
1.  Auth prüfen
2.  Inputs validieren (Zod)
3.  Einen Service aufrufen
4.  Ergebnis zurückgeben (oder revalidieren)

**Tasks:**
- [x] **Ordnerstruktur erstellen:** `src/services/` anlegen.
- [x] **JobService:** CRUD Logik für Jobs aus Actions extrahieren -> `src/services/job-service.ts`.
- [x] **BackupService:** Logik zum Starten/Triggern von Backups extrahieren -> `src/services/backup-service.ts`.
- [x] **RestoreService:** Logik für Wiederherstellung -> `src/services/restore-service.ts`.
- [ ] **AuthService:** (Optional) Falls Auth-Logik komplexer wird.

---

## 2. Kernlogik: Pipeline Pattern für `runner.ts`
**Status:** [x] Erledigt

**Problem:**
Die Datei `src/lib/runner.ts` ist ein "God Object". Sie macht alles: Pfade berechnen, DB Dump aufrufen, Files zippen, verschlüsseln, hochladen, Datenbank updaten. Das ist schwer zu warten und fehleranfällig zu erweitern.

**Lösung:**
Aufbrechen des Prozesses in kleine, isolierte "Steps" (Pipeline Pattern).

**Tasks:**
- [x] **Interface definieren:** Ein cleanes Interface für einen `PipelineStep` definieren (Input -> Process -> Output).
- [x] **Steps extrahieren:** Logik in einzelne Dateien unter `src/lib/runner/steps/` aufteilen:
    - `01-prepare-context.ts` (Pfade, Config)
    - `02-execute-dump.ts` (Adapter Aufruf)
    - `03-compress-encrypt.ts` (Optional)
    - `04-upload-storage.ts` (Upload zu S3/FTP/etc.)
    - `05-cleanup.ts` (Temp Files löschen)
- [x] **Runner Orchestrator:** `runner.ts` so umschreiben, dass er nur noch diese Steps nacheinander aufruft und Errors fängt.

---

## 3. UI: Komponenten Entkopplung
**Status:** [ ] Offen

**Problem:**
In Listenansichten (z.B. `actions/storage/columns.tsx` oder `dashboard/page.tsx`) wird oft zu viel Logik (Formatierung, Badges, Icons) direkt definiert. Die Dateien werden unübersichtlich.

**Lösung:**
Extraktion von "dummen" UI-Komponenten.

**Tasks:**
- [ ] **Cell-Renderer extrahieren:** Komplexe Spalten in `src/components/dashboard/[domain]/cells/` auslagern (z.B. `StatusCell`, `ActionMenu`).
- [ ] **Shared Components:** Wiederkehrende Patterns (z.B. "Card mit Header und Action Button") vereinheitlichen.

---

## 4. Testing & QA (Vorbereitung)
**Status:** [ ] Offen

Durch die Schritte 1 und 2 wird das Testen deutlich einfacher.
- [ ] Unit Tests für die neuen `Services` schreiben (da diese nun entkoppelt von Next.js Actions sind).
- [ ] Unit Tests für einzelne `Pipeline Steps` schreiben.
