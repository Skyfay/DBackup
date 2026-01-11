# AI Notes for Backup Control Plane

## Purpose
Lightweight control plane UI for backups, storage locations, and notification channels. Currently mock/in-memory state; ready to swap for real APIs.

## Domain model
- `BackupTarget` (src/lib/types.ts): engine, host, database, schedule (cron string), retentionDays, storageLocationId, notificationChannelIds, status, lastRun.
- `StorageLocation`: S3/GCS/Azure/local endpoint metadata + encryption flag.
- `NotificationChannel`: email/discord/webhook target with enabled flag.
- Helpers live in `src/lib/services/*` and are pure (no side effects beyond returned arrays).

## UI layout
- Shell & sidebar: src/components/layout/*
- Dashboard (client): src/components/dashboard/dashboard.tsx
- shadcn-style UI kit: src/components/ui/*
- Toasts: sonner via Toaster in app/layout.tsx

## Extending
- Add new channel types: extend `NotificationChannelType`, update forms + helpers; keep IDs unique via `createId`.
- Persist data: replace helper calls with API/server actions; keep return shapes identical for drop-in replacement.
- Add scheduling/backfill logic: introduce `BackupRun` records and surface last/next runs.

## Prompts to reuse
- "Add a new notification channel type and wire it through the dashboard form and state service."
- "Swap mock services for real API calls but keep the `Dashboard` component props stable."
- "Add detail views per backup target showing recent runs and storage footprints."
