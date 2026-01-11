# Backup Control Plane (Next.js + shadcn/ui)

Interactive control plane to model backup targets, storage locations, and pluggable notification channels. Built with Next.js App Router, Tailwind CSS 3, and shadcn/ui components.

## Quickstart / Starten

```bash
pnpm install
pnpm dev
```

Then open http://localhost:3000. The dashboard uses mock data and in-memory state; no backend is required.

## Concepts
- **Backup targets**: engine (Postgres/MySQL/Mongo/etc.), host, schedule (cron), retention, linked storage, linked notification channels.
- **Storage locations**: S3/GCS/Azure/local endpoints with encryption + region metadata.
- **Notification channels**: Discord, email, or webhook targets; can be attached to any backup target.
- **Actions**: run a backup now, add targets/storage/channels through forms; toast feedback via `sonner`.

## Structure
- App shell & layout: `src/app/layout.tsx`, `src/components/layout/*`
- Dashboard UI: `src/components/dashboard/dashboard.tsx`
- Domain models: `src/lib/types.ts`
- Mock data: `src/lib/data/mock-data.ts`
- Pure helpers: `src/lib/services/*`, `src/lib/utils.ts`
- UI kit (shadcn-style): `src/components/ui/*`

## Extending
- Add a real API layer by replacing the mock services with fetch calls or server actions.
- New notification channels: extend `NotificationChannelType`, add an adapter in `src/lib/services/notifications.ts`, and surface it in the form select.
- Storage backends: extend `StorageLocationType` and use the same `createStorageLocation` helper.

For architecture notes and AI prompts, see [docs/AI.md](docs/AI.md).

## shadcn/ui Hinweis
- UI-Komponenten folgen dem shadcn/ui-Stil (Radix + Tailwind). Sie liegen unter `src/components/ui` und nutzen `tailwindcss-animate`, `class-variance-authority`, `lucide-react`, etc.
- Kein CLI-Scaffold nötig; bei Bedarf kannst du weitere Komponenten nach https://ui.shadcn.com/ ergänzen.
