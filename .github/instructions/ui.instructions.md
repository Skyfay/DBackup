---
applyTo: "src/components/**/*.tsx, src/app/**/*.tsx"
---

# UI & Frontend Standards

## Tech Stack
- **Framework**: Next.js 16 App Router (nutze Server Components standardmäßig, `use client` nur wenn nötig).
- **Styling**: Tailwind CSS (mobile-first).
- **Komponenten**: Shadcn UI. Nutze existierende Primitive aus `src/components/ui/`.
- **Formulare**: `react-hook-form` + `zod` für Schema-Validierung. Siehe [`src/components/adapter-manager.tsx`](src/components/adapter-manager.tsx) als Referenz.

## Styling Regeln
- Keine Inline-Styles. Nutze Tailwind Utility Classes.
- Nutze `toast` für Benutzerfeedback (Success/Error) anstatt `alert()`.

## Datum & Zeit Darstellung
- **VERBOTEN**: Nutze NIEMALS `new Date().toLocaleDateString()` oder manuelle Formatierung im JSX.
- **PFLICHT**: Nutze IMMER die Komponente `<DateDisplay />` aus [`src/components/date-display.tsx`](src/components/date-display.tsx).
  - Beispiel: `<DateDisplay date={backup.createdAt} />`
  - Dies stellt sicher, dass die Zeitzone und das Format des Users aus der Session respektiert werden.

## Architektur
- Trenne Datenabruf (Server Actions/API) von der Präsentation.
- Validiere Props mit TypeScript Interfaces (z.B. `interface AdapterFormProps`).