# Storage Adapter Development Guide

This guide explains how to add new storage destinations (S3, SFTP, WebDAV, etc.) to the Database Backup Manager.

## Architecture Overview

Storage adapters are responsible for transferring backup files to a remote location.
Crucially, **we use a streaming architecture**.
An adapter receives a `localPath` (temp file) but should ideally stream it to the destination for performance and memory efficiency, although some libraries might require a file path.

**Key Rule**:
Prefer **Native Node.js implementations** over CLI wrappers (like `rclone`) whenever possible.
*   ✅ `@aws-sdk/client-s3` (Native, robust)
*   ❌ `rclone` (External binary dependency, fragile parsing)
*   Exception: `rsync` or `smbclient` if no robust JS alternative exists.

---

## Step 1: Define Configuration Schema

All adapters must define a Zod schema for their configuration usage in the UI.
Edit `src/lib/adapters/definitions.ts`:

```typescript
// src/lib/adapters/definitions.ts

export const S3Schema = z.object({
  endpoint: z.string().optional().describe("API Endpoint (e.g. for MinIO/R2)"),
  region: z.string().default("us-east-1"),
  bucket: z.string().min(1, "Bucket name is required"),
  accessKeyId: z.string().min(1, "Access Key is required"),
  secretAccessKey: z.string().min(1, "Secret Key is required"),
  pathPrefix: z.string().optional().describe("Folder prefix (e.g. /backups)"),
});
```

*   **Tip**: Use `.describe()` to add help text in the UI.
*   **Tip**: Use `.default()` to pre-fill values.

---

## Step 2: Implement the Adapter

Create a new file in `src/lib/adapters/storage/` (e.g., `s3.ts`).
It must implement the `StorageAdapter` interface from `@/lib/core/interfaces`.

### Required Methods

*   `upload(config, localPath, remotePath, onProgress, onLog)`: Uploads a file.
*   `download(config, remotePath, localPath)`: Downloads a file (for restore).
*   `list(config, remotePath)`: Lists files (for the storage explorer).
*   `delete(config, remotePath)`: Deletes a file (for retention policy).
*   `test(config)`: Verifies connectivity AND permissions. **Must** attempt to write and then delete a temporary file to ensure the configuration allows backups and retention policies to work.
*   `read(config, remotePath)`: (Optional but Recommended) Reads file content (e.g. `.meta.json`) as string.

### Test Implementation Pattern

The `test()` function should not just ping the server. It must prove that we can **write** (for backups) and **delete** (for retention policies).

```typescript
async test(config: MyConfig): Promise<{ success: boolean; message: string }> {
    const testFile = `.connection-test-${Date.now()}`;
    // Construct path with user-defined prefix if applicable
    const targetPath = config.pathPrefix ? path.join(config.pathPrefix, testFile) : testFile;

    try {
        // 1. Test Write Access
        await myClient.write(targetPath, "Connection Test");

        // 2. Test Delete Access
        await myClient.delete(targetPath);

        return { success: true, message: "Connection successful (Write/Delete verified)" };
    } catch (error: any) {
        return { success: false, message: error.message };
    }
}
```

### Implementation Template

```typescript
import { StorageAdapter, FileInfo } from "@/lib/core/interfaces";
import { S3Schema } from "@/lib/adapters/definitions";
import { createReadStream } from "fs";

export const S3StorageAdapter: StorageAdapter = {
    id: "s3-compatible",  // Unique ID
    type: "storage",
    name: "S3 Compatible", // Display Name
    configSchema: S3Schema,

    // ... implementation
};
```

---

## Security & Encryption

Sensitive configuration fields (passwords, secret keys, tokens) are **automatically encrypted** at rest in the database.

**Requirement**:
You must name your schema fields using one of the recognized sensitive keywords found in `src/lib/crypto.ts`.

Common recognized keys:
*   `password`
*   `secret` / `secretKey` / `secretAccessKey`
*   `token` / `apiKey`
*   `accessKey` / `accessKeyId`
*   `passphrase`

If you use a different name (e.g., `my_custom_code`), it will **NOT** be encrypted!

---

## Step 3: Register the Adapter

Finally, register your new adapter in the global registry.
Edit `src/lib/adapters/index.ts`:

```typescript
// src/lib/adapters/index.ts
import { S3StorageAdapter } from "./storage/s3";

export function registerAdapters() {
    // ... existing adapters
    registry.register(S3StorageAdapter); // <--- Add this
}
```

---

## UI Integration

You do **not** need to create any React components.
The `src/components/adapter/adapter-form.tsx` component automatically generates the configuration form based on your Zod schema defined in Step 1.

*   `z.string()` -> Input field
*   `z.boolean()` -> Switch
*   `z.number()` -> Input (type=number)
*   `z.enum()` -> Select dropdown

## Testing

1.  Restart the dev server (`pnpm dev`).
2.  Go to `Destinations` -> `New Destination`.
3.  Your new adapter should appear in the "Type" dropdown.
4.  Configure it and use the "Test Connection" button (implement the `test()` method for this to work!).
