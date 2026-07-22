import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import * as encryptionService from "@/services/backup/encryption-service";
import AdmZip from "adm-zip";
import fs from "fs/promises";
import path from "path";
import { auditService } from "@/services/audit-service";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";

const log = logger.child({ route: "vault/recovery-kit" });

export async function GET(
    request: NextRequest,
    props: { params: Promise<{ id: string }> }
) {
    const params = await props.params;
    const { id } = params;

    // 1. Auth & Permissions
    const headersList = await headers();
    const ctx = await getAuthContext(headersList);
    if (!ctx) {
        return new NextResponse("Unauthorized", { status: 401 });
    }

    // Security: Require VAULT.WRITE for master key export (sensitive operation)
    checkPermissionWithContext(ctx, PERMISSIONS.VAULT.WRITE);

    // Audit log: Track master key export
    await auditService.log(
        ctx.userId,
        AUDIT_ACTIONS.EXPORT,
        AUDIT_RESOURCES.VAULT,
        { action: 'recovery_kit_download', profileId: id },
        id
    );

    try {
        // 2. Fetch Profile & Key
        const profile = await encryptionService.getEncryptionProfile(id);
        if (!profile) {
            return new NextResponse("Profile not found", { status: 404 });
        }

        const masterKeyHex = await encryptionService.getDecryptedMasterKey(id);

        // 3. Prepare Files
        const zip = new AdmZip();

        // A. Master Key File
        zip.addFile("master.key", Buffer.from(masterKeyHex, "utf8"));

        // B. Recovery Scripts (Read from disk)
        //
        // Two are shipped because there are two archive formats in the wild, and picking
        // the wrong one in a disaster is exactly the kind of friction a recovery kit exists
        // to remove:
        //   - restore_archive.js decrypts and unpacks seekable (v2) archives, which is what
        //     jobs with directory sources produce. It can also list and extract single files.
        //   - decrypt_backup.js decrypts whole-file encrypted backups, which is what every
        //     database-only job produces.
        for (const script of ["restore_archive.js", "decrypt_backup.js"]) {
            try {
                const scriptContent = await fs.readFile(path.join(process.cwd(), "scripts", script), "utf8");
                zip.addFile(script, Buffer.from(scriptContent, "utf8"));
            } catch (e: unknown) {
                log.error("Failed to read recovery script", { script }, wrapError(e));
                zip.addFile(
                    `ERROR_MISSING_${script}.txt`,
                    Buffer.from(`Could not find scripts/${script} on server.`, "utf8")
                );
            }
        }

        // C. Helper Scripts (Pre-filled with Key for easing usage)
        const batContent = `@echo off
if "%~1"=="" (
    echo Usage: Drag and drop an .enc file onto this script
    pause
    exit /b
)
echo Decrypting %~nx1 ...
node decrypt_backup.js "%~1" "${masterKeyHex}"
pause
`;
        zip.addFile("decrypt_drag_drop_windows.bat", Buffer.from(batContent, "utf8"));

        const shContent = `#!/bin/bash
if [ -z "$1" ]; then
    echo "Usage: ./decrypt.sh <backup_file.enc>"
    exit 1
fi
node decrypt_backup.js "$1" "${masterKeyHex}"
`;
        zip.addFile("decrypt_linux_mac.sh", Buffer.from(shContent, "utf8"));
        // Make sh executable (chmod info is stored in zip external attributes)
        // 0o755 = 493 decimal. Shifted by 16 bits = 32309248 (0x1ED0000L) ??
        // AdmZip allows setting unix permissions?
        // zip.getEntry("decrypt_linux_mac.sh").header.attr = ... (complex)
        // We'll skip complex permission setting for now, user can chmod +x.

        // D. README
        const readmeContent = `# Recovery Kit for Profile: ${profile.name}
Generated at: ${new Date().toISOString()}

This kit decrypts your backups WITHOUT DBackup. Keep it somewhere safe, and NOT next to
your backups.

## CONTENTS
1. master.key                      - Your raw 64-character hex key. KEEP IT SAFE.
2. restore_archive.js              - Lists and extracts file backups (archives with directory sources).
3. decrypt_backup.js               - Decrypts database-only backups.
4. decrypt_drag_drop_windows.bat   - Helper for Windows (drag and drop a .enc file).
5. decrypt_linux_mac.sh            - Helper for Linux/macOS.

## WHICH SCRIPT DO I NEED?

Look at the backup file next to your archive:

- A '.enc' file, or a job that backs up only databases
  -> use decrypt_backup.js

- A '.tar' file from a job that includes directory sources
  -> use restore_archive.js. These archives encrypt each file individually, which is what
     lets you pull out a single file instead of the whole backup.

## PREREQUISITES

Node.js 18 or newer. Download from https://nodejs.org/
Nothing else - no npm install, no DBackup server, no database.

## FILE BACKUPS (restore_archive.js)

See what is inside:
    node restore_archive.js --list backup.tar <paste-master.key-here>

Extract everything:
    node restore_archive.js --extract backup.tar ./restored <paste-master.key-here>

Extract just part of it (patterns accept * and **, and a folder name takes everything in it):
    node restore_archive.js --extract backup.tar ./restored <key> 'www/**'
    node restore_archive.js --extract backup.tar ./restored <key> docs

Every extracted file is checked against the checksum recorded when the backup was made.
The key argument can be left out for unencrypted archives.

### Without this kit at all
An UNENCRYPTED archive of this type is a plain TAR:
    tar -xf backup.tar
If the job used compression, the extracted files are gzip/brotli streams - run
'gunzip' or 'brotli -d' on them afterwards. Encrypted archives always need this kit.

## DATABASE BACKUPS (decrypt_backup.js)

### Windows
Drag your '.enc' backup file onto 'decrypt_drag_drop_windows.bat'.

### Linux / macOS
    chmod +x decrypt_linux_mac.sh
    ./decrypt_linux_mac.sh /path/to/backup.enc

### Manual
    node decrypt_backup.js <file.enc> <hex_key>

The output is still compressed if the job used compression:
    gunzip backup.sql.gz      # or: brotli -d backup.sql.br
`;
        zip.addFile("README.txt", Buffer.from(readmeContent, "utf8"));

        // 4. Generate & Send
        const zipBuffer = zip.toBuffer();

        const sanitizedName = profile.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const filename = `recovery_kit_${sanitizedName}.zip`;

        return new NextResponse(zipBuffer as any, {
            status: 200,
            headers: {
                "Content-Type": "application/zip",
                "Content-Disposition": `attachment; filename="${filename}"`
            }
        });

    } catch (error: unknown) {
        log.error("Recovery kit generation error", { profileId: id }, wrapError(error));
        return new NextResponse("Internal Server Error", { status: 500 });
    }
}
