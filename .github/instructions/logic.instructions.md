---
applyTo: "src/lib/**/*.ts, src/app/api/**/*.ts, src/utils/**/*.ts"
---

# Backend & Logik Standards

## Datenbank (Prisma)
- Nutze Prisma Client für alle DB-Operationen.
- Schreibe keine rohen SQL-Queries, es sei denn, es ist für Performance absolut notwendig.
- Schema-Änderungen gehören immer in `prisma/schema.prisma`.

## Error Handling
- API Routen müssen immer ein strukturiertes JSON zurückgeben, z.B. `{ success: boolean, message?: string, data?: any }`.
- Fange Fehler mit `try/catch` ab und nutze `console.error` für Server-Logs, aber bereinigte Fehlermeldungen an den Client zurück.

## Datums-Logik (Backend)
- Speichere Daten in der DB immer als UTC (ISO 8601).
- Wenn Datums-Manipulation notwendig ist, nutze `date-fns` oder `date-fns-tz`.
- Verlasse dich nicht auf die Server-Systemzeit, sondern nutze UTC.

## API Typisierung
- Nutze `NextResponse` aus `next/server`.
- Validiere eingehende Request-Bodys strikt mit `zod`, bevor du sie verarbeitest.