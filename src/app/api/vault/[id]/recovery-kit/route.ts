import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { getUserPermissions } from "@/lib/access-control";
import { PERMISSIONS } from "@/lib/permissions";
import * as encryptionService from "@/services/encryption-service";
import AdmZip from "adm-zip";
import fs from "fs/promises";
import path from "path";
import { auditService } from "@/services/audit-service";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { logger } from "@/lib/logger";
import { wrapError } from "@/lib/errors";

const log = logger.child({ route: "vault/recovery-kit" });

export async function GET(
    request: NextRequest,
    props: { params: Promise<{ id: string }> }
) {
    const params = await props.params;
    const { id } = params;

    // 1. Auth & Permissions
    const headersList = await headers();
    const session = await auth.api.getSession({ headers: headersList });
    if (!session) {
        return new NextResponse("Unauthorized", { status: 401 });
    }

    // Security: Require VAULT.WRITE for master key export (sensitive operation)
    const permissions = await getUserPermissions();
    if (!permissions.includes(PERMISSIONS.VAULT.WRITE)) {
        return new NextResponse("Forbidden - Write permission required for key export", { status: 403 });
    }

    // Audit log: Track master key export
    if (session.user) {
        await auditService.log(
            session.user.id,
            AUDIT_ACTIONS.EXPORT,
            AUDIT_RESOURCES.VAULT,
            { action: 'recovery_kit_download', profileId: id },
            id
        );
    }

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

        // B. Decryption Script (Read from disk)
        try {
            const scriptPath = path.join(process.cwd(), "scripts", "decrypt_backup.js");
            const scriptContent = await fs.readFile(scriptPath, "utf8");
            zip.addFile("decrypt_backup.js", Buffer.from(scriptContent, "utf8"));
        } catch (e: unknown) {
            log.error("Failed to read decrypt_backup.js script", {}, wrapError(e));
            // Fallback: Add error note in readme
            zip.addFile("ERROR_MISSING_SCRIPT.txt", Buffer.from("Could not find scripts/decrypt_backup.js on server.", "utf8"));
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

## CONTENTS
1. master.key                 - Your raw 64-character hex key. KEEP IT SAFE.
2. decrypt_backup.js          - The Node.js logic to decrypt files.
3. decrypt_drag_drop_windows.bat - Helper for Windows (Drag & Drop .enc file).
4. decrypt_linux_mac.sh       - Helper for Linux/Mac.

## INSTRUCTIONS

### Prerequisites
You must have Node.js installed on your computer.
Download from: https://nodejs.org/

### Windows
1. Install Node.js.
2. Drag your '.enc' backup file and drop it onto 'decrypt_drag_drop_windows.bat'.
3. The decrypted file will appear next to the original.

### Linux / macOS
1. Install Node.js.
2. Open terminal in this folder.
3. Run: chmod +x decrypt_linux_mac.sh
4. Run: ./decrypt_linux_mac.sh /path/to/backup.enc

### Manual Usage
node decrypt_backup.js <file.enc> <hex_key>
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
