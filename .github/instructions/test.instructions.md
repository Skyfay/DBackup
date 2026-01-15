---
applyTo: "**/*.test.ts, **/*.spec.ts, **/*.test.tsx"
---

# Testing Standards

## Infrastruktur
- Beachte [`docker-compose.test.yml`](docker-compose.test.yml) für Integrationstests.
- Tests dürfen keine persistente Auswirkung auf die lokale Entwicklungs-DB haben (nutze Test-Container oder Transaktionen).

## Testing Pattern
- **Unit Tests**: Mocke externe Aufrufe (z.B. API Calls, Dateisystem-Zugriffe).
- **Integration Tests**: Teste gegen die echten Services definiert in der `docker-compose.test.yml` (MySQL, Postgres, Mongo), wenn möglich.
- Nutze aussagekräftige `describe` und `it` Blöcke.

## Mocking
- Wenn du `fetch` in Komponenten testest, mocke die Antwort immer so, dass sie der Struktur `{ success: boolean, ... }` entspricht.