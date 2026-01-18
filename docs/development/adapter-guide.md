# Adapter Development Guide

This guide explains how to extend the Database Backup Manager by adding support for new Databases, Storage providers, or Notification channels.

## 1. Overview

The application uses a **Plugin/Adapter Architecture**. The core logic does not know about specific technologies (like AWS S3 or MySQL); it only knows about the `Adapter` interfaces.

### Location
*   **Interfaces**: `src/lib/core/interfaces.ts`
*   **Definitions**: `src/lib/adapters/definitions.ts` (Zod schemas)
*   **Implementations**: `src/lib/adapters/[type]/[name].ts`
*   **Registration**: `src/lib/adapters/index.ts`

## 2. Step-by-Step: Adding a Database Adapter

Let's assume we want to add support for **SQLite**.

### Step 1: Define the Configuration Schema
Modify `src/lib/adapters/definitions.ts`. Create a Zod schema for the UI form connection fields.

```typescript
export const SQLiteSchema = z.object({
    path: z.string().min(1, "Database file path is required"),
    options: z.string().optional()
});
```

### Step 2: Implement the Interface
Create `src/lib/adapters/database/sqlite.ts`. You must implement `DatabaseAdapter`.

```typescript
import { DatabaseAdapter, BackupResult } from "@/lib/core/interfaces";
import { SQLiteSchema } from "@/lib/adapters/definitions";
import { exec } from "child_process";
// ... imports

export const SQLiteAdapter: DatabaseAdapter = {
    id: "sqlite",
    type: "database",
    name: "SQLite",
    configSchema: SQLiteSchema,

    async dump(config: { path: string }, destinationPath: string): Promise<BackupResult> {
        // Implement the CLI command to dump data
        // For SQLite: probably copying the file or using `.dump` command
        // IMPORTANT: Ensure destinationPath is written to.
        return { success: true, size: 1024, logs: [] };
    },

    async restore(config, sourcePath): Promise<BackupResult> {
        // Implement restore logic
    }
};
```

### Step 3: Register the Adapter
Open `src/lib/adapters/index.ts` and add it to the `registerAdapters` function.

```typescript
import { SQLiteAdapter } from "./database/sqlite";

export function registerAdapters() {
    // ... existing
    registry.register(SQLiteAdapter);
}
```

**Done!** The UI will automatically pick up the new adapter, generate the form based on the Zod schema, and the Runner will be able to use it.

## 3. Storage Adapters

Implement the `StorageAdapter` interface.

**Key Requirements:**
*   **`list(config, path)`**: Must return standard `FileInfo[]`.
*   **`upload` / `download`**: Must handle streams or file copies efficiently.
*   **Metadata**: Since the "Storage Explorer" update, ensure your `upload` method handles the naming convention correctly (though the Runner handles the *logic* of calling upload for both .sql and .meta.json, the adapter just moves bytes).
*   **`read?` (Optional)**: Highly recommended for performance. Allows reading small text files (like `.meta.json`) without downloading them to disk first.

## 4. Notification Adapters

Implement the `NotificationAdapter` interface.

**Key Requirements:**
*   **`send(config, message, context)`**:
    *   `message`: The simple string message.
    *   `context`: Object containing `{ jobName, status, duration, size }`.
    *   Use the context to build rich messages (e.g. Discord Embeds or HTML Emails).

## 5. Testing your Adapter

1.  **Unit Test**: Create `tests/adapters/sqlite.test.ts`.
2.  **Integration**: Add a container to `docker-compose.test.yml` if the technology requires a service (like a new Database).
3.  **UI Test**: Go to `/dashboard/destinations` (or sources) and use the "Test Connection" button. Ensure you implement the `test()` method in your adapter for this to work!
