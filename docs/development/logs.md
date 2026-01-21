# Log System Rework Implementation Plan

This document outlines the steps to refactor the logging system to support structured, visual logs (Coolify-style) with "Command" vs "Info" separation.

## 1. Type Definitions
Create a central type definition file to ensure consistency between Backend (Runner) and Frontend (Viewer).

- **File**: `src/lib/core/logs.ts`
- **Content**:
    - `LogLevel`: 'info' | 'success' | 'warning' | 'error'
    - `LogType`: 'general' | 'command'
    - `LogEntry` interface: timestamp, level, type, message, details, context, durationMs.

## 2. UI Component (LogViewer)
Create a new React component to visualize the logs.

- **File**: `src/components/execution/log-viewer.tsx`
- **Features**:
    - Shadcn ScrollArea & Accordion/Collapsible patterns.
    - Badges for status.
    - Visual timeline connector (vertical line).
    - Auto-scroll capability.
    - **Backward Compatibility**: Must handle legacy string logs gracefully.

## 3. Integration in Dashboard
Replace the current log display in the History view.

- **File**: `src/app/dashboard/history/page.tsx` (or `log-dialog.tsx` if extracted).
- **Action**: Swap `<pre>` or simple list with `<LogViewer />`.

## 4. Runner Update (Backend)
Update the execution runner to produce structured logs.

- **File**: `src/lib/runner.ts`
- **Change**:
    - Change internal `logs` array from `string[]` to `LogEntry[]`.
    - Update `log()` helper to accept `details` (e.g., stdout/stderr).
    - Create `logCommand()` helper.
    - When saving to DB (`prisma.execution.update`), `JSON.stringify` the logs array (since SQLite stores it as String).

## 5. Service Layer Updates (Optional/Gradual)
Update individual services to leverage the new logging capabilities.

- **Files**: `src/services/*.ts`
- **Change**: Return structured output or pass Logger context deeper to capture command outputs precisely.

## 6. Migration/Compatibility Validation
- Ensure existing logs (plain text) still render readable in the new viewer.
- Ensure new logs are correctly saved and retrieved.
