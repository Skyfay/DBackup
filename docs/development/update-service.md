# Update Service Documentation

Der **Update Service** (`src/services/update-service.ts`) ist für die Überprüfung auf neue Versionen des Database Backup Managers verantwortlich. Er fragt die GitLab Container Registry API ab, analysiert verfügbare Tags und vergleicht sie intelligent mit der aktuell installierten Version unter Berücksichtigung des Release-Kanals (Stable, Beta, Dev).

## Funktionsweise

Der Update-Check läuft in folgenden Schritten ab:

1.  **Konfigurations-Check**: Prüft in der Datenbank (`SystemSetting`), ob `general.checkForUpdates` aktiviert ist. Wenn deaktiviert, wird die Prüfung übersprungen.
2.  **API-Abfrage**: Ruft die letzten 20 Tags von der öffentlichen GitLab API ab (`gitlab.com/api/v4/...`).
    *   *Warum 20 Tags?* Um sicherzustellen, dass Stable-Releases auch dann gefunden werden, wenn viele neuere Dev-Tags existieren.
    *   *Caching*: Die Antwort wird für 1 Stunde gecacht (`next: { revalidate: 3600 }`).
3.  **Channel-Erkennung**: Bestimmt den "Stabilitäts-Kanal" der aktuellen Installation.
4.  **Filterung**: Filtert verfügbare Updates basierend auf dem aktuellen Kanal (siehe [Channel-Logik](#channel-logik)).
5.  **SemVer-Vergleich**: Sortiert relevante Tags nach Semantic Versioning und prüft, ob eine neuere Version existiert.

## Channel-Logik

Das System unterscheidet drei Stabilitätsstufen (Channels). Ein Benutzer sieht niemals Updates, die "instabiler" sind als seine aktuelle Version.

| Aktueller Kanal | Version-Pattern | Stabilitäts-Level | Sichtbare Updates | Verhalten |
| :--- | :--- | :--- | :--- | :--- |
| **Stable** | `x.y.z` | 3 | **Stable** | Nur offizielle Releases. Keine Beta/Dev Versionen. |
| **Beta** | `x.y.z-beta` | 2 | **Beta**, **Stable** | Updates auf neuere Betas oder ein in der Zwischenzeit erschienenes Stable Release. |
| **Dev** | `x.y.z-dev` | 1 | **Dev**, **Beta**, **Stable** | Bleeding Edge. Sieht jede neuere Version. |

### Priorisierung im Code
Die Stabilität wird numerisch bewertet:
```typescript
function getStability(prerelease: string | null): number {
    if (prerelease === null) return 3; // Stable
    if (prerelease.includes('beta')) return 2; // Beta
    if (prerelease.includes('dev')) return 1; // Dev
    return 0; // Unknown
}
```

Es werden nur Tags berücksichtigt, deren Stabilität **größer oder gleich** der eigenen ist:
`TargetStability >= CurrentStability`

## Semantic Versioning Vergleich

Der Vergleich erfolgt strikt nach [SemVer](https://semver.org/) Regeln:

1.  **Major/Minor/Patch**: Klassischer Zahlenvergleich (z.B. `1.1.0 > 1.0.9`).
2.  **Pre-Release**: Wenn die Versionen identisch sind, gewinnt die stabilere Version.
    *   `1.0.0` > `1.0.0-beta` > `1.0.0-dev`

## API Endpunkt

Genutzte GitLab Registry API:
`GET /projects/:id/registry/repositories/:repo_id/tags`

Parameter:
- `per_page=20`: Anzahl der abzurufenden Tags.
- `order_by=updated_at`: Sortierung nach Datum.
- `sort=desc`: Neueste zuerst.

## Verwendung

### Im Backend (System Task)
Der `system-task-service.ts` führt den Update-Check täglich aus (wenn konfiguriert).

### Im Frontend
Die Komponente `src/components/layout/sidebar.tsx` ruft den Status ab.
- Wenn `check.updateAvailable === true`:
  - Wird Version im Footer angezeigt.
  - Pulsierende Animation signalisiert Verfügbarkeit.
  - Klick führt zum Release-Link (aktuell Platzhalter/GitLab).

## Hinzufügen neuer Channels

Um einen neuen Kanal (z.B. `rc` für Release Candidates) hinzuzufügen:

1.  Erweitere `interface ParsedVersion` in `update-service.ts`.
2.  Passe `getStability` an (z.B. `if (prerelease.includes('rc')) return 2.5;`).
3.  Die Vergleichslogik übernimmt die numerische Sortierung automatisch.
