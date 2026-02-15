import { NextRequest, NextResponse } from "next/server";
import { registry } from "@/lib/core/registry";
import { registerAdapters } from "@/lib/adapters";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { checkPermission } from "@/lib/access-control";
import { PERMISSIONS, Permission } from "@/lib/permissions";

// Ensure adapters are registered
registerAdapters();

// Helper to determine permission based on adapter type
function getPermissionForAdapter(adapterId: string): Permission | null {
    if (/mysql|postgres|mongo|mssql|sqlite/i.test(adapterId)) {
        return PERMISSIONS.SOURCES.READ;
    } else if (/local-filesystem|s3|sftp|smb|ftp|webdav|rsync|google-drive|dropbox|onedrive/i.test(adapterId)) {
        return PERMISSIONS.DESTINATIONS.READ;
    } else if (/discord|email|smtp|slack/i.test(adapterId)) {
        return PERMISSIONS.NOTIFICATIONS.READ;
    }
    return null;
}

export async function POST(req: NextRequest) {
    const session = await auth.api.getSession({
        headers: await headers()
    });

    if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const body = await req.json();
        const { adapterId, config } = body;

        // RBAC: Check permission based on adapter type
        const requiredPermission = getPermissionForAdapter(adapterId || '');
        if (requiredPermission) {
            await checkPermission(requiredPermission);
        }

        if (!adapterId || !config) {
            return NextResponse.json({ success: false, message: "Missing required fields" }, { status: 400 });
        }

        const adapter = registry.get(adapterId);

        if (!adapter) {
            return NextResponse.json({ success: false, message: "Adapter not found" }, { status: 404 });
        }

        if (!adapter.getDatabases) {
            return NextResponse.json({ success: false, message: "This adapter does not support listing databases." });
        }

        const databases = await adapter.getDatabases(config);

        return NextResponse.json({ success: true, databases });

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return NextResponse.json({ success: false, message }, { status: 500 });
    }
}
