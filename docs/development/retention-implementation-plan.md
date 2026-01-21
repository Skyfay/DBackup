# Retention Policy Implementation Plan

This document outlines the implementation plan for adding Retention Policies (including Smart Rotation/GVS) to the Database Backup Manager.

## 1. Database Schema Update

We will add a flexible JSON field to the `Job` model to store retention configuration. This avoids rigid columns and allows future extensibility.

- [ ] **Modify `prisma/schema.prisma`**:
    - Add `retention` field to `Job` model.
    - Type: `String` (storing JSON).
    - Default: `"{}"`.

```prisma
model Job {
  // ... existing fields
  retention     String    @default("{}") // Stores RetentionPolicy
}
```

- [ ] **Define Types (`src/lib/core/retention.ts`)**:
    - `RetentionMode`: `"NONE" | "SIMPLE" | "SMART"`
    - `SimplePolicy`: `{ keepCount: number }`
    - `SmartPolicy`: `{ daily: number, weekly: number, monthly: number, yearly: number }`
    - `RetentionConfig`: Union of the above.

## 2. Service Layer (Core Logic)

We need a dedicated service to calculate which files to keep and which to delete. This logic must be pure and testable.

- [ ] **Create `src/services/retention-service.ts`**:
    - `calculateRetention(files: BackupFile[], policy: RetentionConfig): { keep: BackupFile[], delete: BackupFile[] }`
    - Implementation of GVS (Grandfather-Father-Son) algorithm.
        - **Daily**: Keep last N days (1 per day).
        - **Weekly**: Keep last N weeks (1 per week, e.g., Sunday).
        - **Monthly**: Keep last N months (1 per month, e.g., 1st of month).
        - **Yearly**: Keep last N years.

## 3. Unit Testing

Since deletion is destructive, we must have robust tests.

- [ ] **Create `tests/unit/services/retention-service.test.ts`**:
    - Test "Simple" mode (count based).
    - Test "Smart" mode with various date distributions.
    - Edge cases: Empty list, single file, gaps in dates.

## 4. Runner Integration

The retention cleanup should run **after** a successful backup upload.

- [ ] **Create `src/lib/runner/steps/05-retention.ts`**:
    - Fetch existing backups from `StorageAdapter`.
    - Apply `RetentionService` logic.
    - Delete marked files via `StorageAdapter.deleteFile`.
    - Log actions.
- [ ] **Update `src/lib/runner/backup-runner.ts`**:
    - Add `stepRetention` to the pipeline chain.

## 5. UI Implementation

Users need to configure this in the Job Editor.

- [ ] **Update `src/components/dashboard/jobs/job-form.tsx`**:
    - Add "Retention Policy" section.
    - Select: No Retention / Simple / Smart.
    - Conditional inputs based on selection.
    - Zod validation updates in `src/app/actions/job-actions.ts`.

## 6. Verification

- [ ] Create a job with retention.
- [ ] Create dummy backup files in the destination.
- [ ] Run job and verify correct files are deleted.
