# Healthcheck & Connectivity Monitoring Implementierung

Dieses Dokument beschreibt den Plan zur Implementierung eines automatischen "Heartbeat"-Systems, das die Erreichbarkeit von Datenbank-Quellen und Speicher-Zielen überwacht.

## 🧱 1. Datenmodell (Schema)

Wir benötigen eine effiziente Speicherung der Ping-Historie sowie eine Erweiterung der bestehenden Konfigurationen für den aktuellen Status.

### Prisma Schema Änderungen

```prisma
// Status-Enum für Health-Checks
enum HealthStatus {
  ONLINE
  DEGRADED // Transiente Fehler (erster/zweiter Fehlversuch)
  OFFLINE  // Dauerhafter Fehler (>= 3 Fehlversuche)
}

// Log-Eintrag für jeden Prüfzyklus (wird regelmäßig bereinigt)
model HealthCheckLog {
  id              String        @id @default(uuid())
  adapterConfigId String
  status          HealthStatus
  latencyMs       Int           // Antwortzeit in Millisekunden
  error           String?       // Fehlermeldung falls fehlgeschlagen
  createdAt       DateTime      @default(now())

  adapterConfig   AdapterConfig @relation(fields: [adapterConfigId], references: [id], onDelete: Cascade)

  @@index([adapterConfigId, createdAt])
}

// Erweiterung des bestehenden AdapterConfig Models
model AdapterConfig {
  // ... existing fields ...

  // Caching-Felder für schnelle UI-Anzeige ohne Joins
  lastHealthCheck      DateTime?
  lastStatus           HealthStatus  @default(ONLINE)
  consecutiveFailures  Int           @default(0) // Zähler für Logik (Grün -> Orange -> Rot)

  healthLogs           HealthCheckLog[]
}
```

## ⚙️ 2. Core Service & Task Logic

Da das Feature als System Task laufen soll, nutzen wir die bestehende Infrastruktur in `SystemTaskService`.

### Neuer System Task
*   **ID**: `SYSTEM_TASKS.HEALTH_CHECK` (`system.health_check`)
*   **Default Schedule**: `*/1 * * * *` (Jede Minute)

### Logik (`src/services/healthcheck-service.ts`)
1.  **Iteriere** über alle `AdapterConfig` Einträge (`type: 'database'` und `type: 'storage'`).
2.  **Ping/Test**:
    *   Rufe `adapter.test(config)` auf (oder eine neue, leichtere Methode `adapter.ping(config)` falls `test` zu schwergewichtig ist).
    *   Messe die Zeit (`latencyMs`).
3.  **Status Bestimmung**:
    *   *Success*: Status `ONLINE`, `consecutiveFailures` auf 0 setzen.
    *   *Failure*: `consecutiveFailures` inkrementieren.
        *   Wenn `consecutiveFailures < 3` -> Status `DEGRADED` (Orange).
        *   Wenn `consecutiveFailures >= 3` -> Status `OFFLINE` (Rot).
4.  **Speichern**:
    *   Erstelle `HealthCheckLog` Eintrag.
    *   Update `AdapterConfig` mit neuem Status.

### Retention Policy (Cleanup)
Da minütliche Logs in SQLite schnell anwachsen:
*   Einbau eines Cleanups am Ende des Healthcheck-Runs oder als separater Task (z.B. `system.cleanup`).
*   Regel: Behalte detaillierte Logs für 24-48 Stunden. Alles ältere löschen oder aggregieren (vorerst löschen).

## 🖥️ 3. UI Komponenten

### Status Indikator (Sonar)
Eine Komponente für Listen (Tabellen), die den aktuellen Status anzeigt.
*   **Grün**: Online.
*   **Orange**: Degraded (Warnung).
*   **Rot**: Offline (Blinkende Animation möglich).

### Health Dashboard / Popover
Beim Klick auf den Indikator öffnet sich ein Dialog/Popover:
*   **Aktuelle Metriken**: "Online seit...", "Letzter Check: vor 20s", "Latenz: 45ms".
*   **History Grid**: Visualisierung wie im Screenshot Request ("GitHub Contribution Graph" Style oder Balken).
    *   Jedes Kästchen repräsentiert z.B. 10 Minuten oder 1 Stunde (je nach Platz).
    *   Tooltip beim Hovern über ein Kästchen: "14:00 - 14:10: 100% Uptime (Avg 20ms)".

## ✅ TODO Liste

### Backend & Datenbank
- [x] `prisma/schema.prisma` anpassen (Logs & Config Felder).
- [x] Migration erstellen (`npx prisma migrate dev`).
- [x] `src/services/healthcheck-service.ts` erstellen:
    - [x] `performHealthCheck()` Methode implementieren.
    - [x] DB Update Logik mit "Consecutive Failures" Logik.
- [x] `SystemTaskService` erweitern: Task registrieren.
- [x] `SystemTasksSettings`: Default Config für den neuen Task hinzufügen.

### Adapter Layer
- [x] Sicherstellen, dass alle `DatabaseAdapter` und `StorageAdapter` eine robuste `test()` Methode haben, die Timeouts schnell erkennt.
- [x] (Optional) Interface um `ping()` Methode erweitern, falls `test()` zu heavy ist.

### API Routes
- [x] GET `/api/adapters/[id]/health-history`: Endpunkt für die Historien-Daten des Grids.

### Frontend (UI/UX)
- [ ] `HealthStatusBadge.tsx` Komponente erstellen (der rot/grün/orange Punkt).
- [ ] `HealthHistoryGrid.tsx` Komponente erstellen (die Matrix-Visualisierung).
- [ ] `src/app/dashboard/sources/columns.tsx` anpassen -> Spalte "Status" hinzufügen.
- [ ] `src/app/dashboard/destinations/columns.tsx` anpassen -> Spalte "Status" hinzufügen.
- [ ] Integration in die Detail-Ansichten (optional).

### Dokumentation & Tests
- [ ] Dokumentation zur Konfiguration des Intervalls aktualisieren.
- [ ] Unit Test für die Orange->Rot Übergangslogik schreiben.
