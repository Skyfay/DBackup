import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { headers } from "next/headers";
import { auditService } from "@/services/audit-service";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS, Permission } from "@/lib/auth/permissions";
import { logger } from "@/lib/logging/logger";
import { wrapError, getErrorMessage } from "@/lib/logging/errors";
import { registerAdapters } from "@/lib/adapters";
import { toAdapterListItem } from "@/lib/adapters/dto";
import { isStorageRole } from "@/lib/core/storage-roles";

registerAdapters();

const log = logger.child({ route: "adapters/[id]/clone" });

function getWritePermissionForType(type: string): Permission {
    switch (type) {
        case "database": return PERMISSIONS.SOURCES.WRITE;
        case "storage": return PERMISSIONS.DESTINATIONS.WRITE;
        case "notification": return PERMISSIONS.NOTIFICATIONS.WRITE;
        default: return PERMISSIONS.SOURCES.WRITE;
    }
}

export async function POST(
    req: NextRequest,
    props: { params: Promise<{ id: string }> }
) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const params = await props.params;
    try {
        const original = await prisma.adapterConfig.findUnique({
            where: { id: params.id }
        });

        if (!original) {
            return NextResponse.json({ success: false, error: "Adapter not found" }, { status: 404 });
        }

        checkPermissionWithContext(ctx, getWritePermissionForType(original.type));

        // Use provided name or generate a unique one: "X (Copy)", then "X (Copy 2)", etc.
        let body: { name?: string; role?: string } = {};
        try { body = await req.json(); } catch { /* no body is fine */ }

        let uniqueName: string;
        if (body.name && body.name.trim()) {
            uniqueName = body.name.trim();
        } else {
            const baseName = `${original.name} (Copy)`;
            uniqueName = baseName;
            let counter = 2;
            while (await prisma.adapterConfig.findFirst({ where: { name: uniqueName, type: original.type } })) {
                uniqueName = `${original.name} (Copy ${counter})`;
                counter++;
            }
        }

        // Without an explicit role the clone keeps the original's - a cloned directory
        // source must not silently come back as a destination. With one, this is the
        // counterpart action: same server and credentials, opposite role.
        if (body.role !== undefined && !isStorageRole(body.role)) {
            return NextResponse.json({ success: false, error: "Invalid storage role" }, { status: 400 });
        }
        const storageRole = isStorageRole(body.role) ? body.role : original.storageRole;

        const cloned = await prisma.adapterConfig.create({
            data: {
                name: uniqueName,
                type: original.type,
                adapterId: original.adapterId,
                storageRole,
                // Copy the encrypted config blob directly - no decrypt/re-encrypt needed
                config: original.config,
                primaryCredentialId: original.primaryCredentialId ?? null,
                sshCredentialId: original.sshCredentialId ?? null,
                ...(original.metadata ? { metadata: original.metadata } : {}),
                // Health fields intentionally omitted - the clone starts fresh
            }
        });

        await auditService.log(
            ctx.userId,
            AUDIT_ACTIONS.CREATE,
            AUDIT_RESOURCES.ADAPTER,
            { name: cloned.name, clonedFrom: original.id },
            cloned.id
        );

        return NextResponse.json(toAdapterListItem(cloned), { status: 201 });
    } catch (error: unknown) {
        log.error("Clone adapter error", { adapterId: params.id }, wrapError(error));
        return NextResponse.json({
            success: false,
            error: getErrorMessage(error) || "Failed to clone adapter"
        }, { status: 500 });
    }
}
