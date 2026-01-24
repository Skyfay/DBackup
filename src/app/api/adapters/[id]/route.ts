import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { encryptConfig } from "@/lib/crypto";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { auditService } from "@/services/audit-service";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";

export async function DELETE(
    req: NextRequest,
    props: { params: Promise<{ id: string }> }
) {
    const session = await auth.api.getSession({
        headers: await headers()
    });

    if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const params = await props.params;
    try {
        // Check for usage in Jobs (Source or Destination)
        const linkedJobs = await prisma.job.findMany({
            where: {
                OR: [
                    { sourceId: params.id },
                    { destinationId: params.id }
                ]
            },
            select: { name: true }
        });

        if (linkedJobs.length > 0) {
            return NextResponse.json({
                success: false, // Ensure success field is present for consistency
                error: `Cannot delete. This adapter is used in the following jobs: ${linkedJobs.map(j => j.name).join(', ')}`
            }, { status: 400 });
        }

        // Technically notifications (Many-to-Many) might be handled automatically by Prisma for implicit relations,
        // or might throw depending on underlying DB constraints.
        // But let's rely on Prisma catch for other cases or strict FKs.

        const deletedAdapter = await prisma.adapterConfig.delete({
            where: { id: params.id },
        });

        if (session.user) {
            await auditService.log(
                session.user.id,
                AUDIT_ACTIONS.DELETE,
                AUDIT_RESOURCES.ADAPTER,
                { name: deletedAdapter.name },
                params.id
            );
        }

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error("Delete Adapter Error:", error);
        return NextResponse.json({
            success: false,
            error: error.message || "Failed to delete adapter"
        }, { status: 500 });
    }
}

export async function PUT(
    req: NextRequest,
    props: { params: Promise<{ id: string }> }
) {
    const session = await auth.api.getSession({
        headers: await headers()
    });

    if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const params = await props.params;
    try {
        const body = await req.json();
        const { name, config } = body;

        const configObj = typeof config === 'string' ? JSON.parse(config) : config;
        const encryptedConfig = encryptConfig(configObj);
        const configString = JSON.stringify(encryptedConfig);

        const updatedAdapter = await prisma.adapterConfig.update({
            where: { id: params.id },
            data: {
                name,
                config: configString
            }
        });

        if (session.user) {
            await auditService.log(
                session.user.id,
                AUDIT_ACTIONS.UPDATE,
                AUDIT_RESOURCES.ADAPTER,
                { name },
                updatedAdapter.id
            );
        }

        return NextResponse.json(updatedAdapter);
    } catch (_error) {
        return NextResponse.json({ error: "Failed to update adapter" }, { status: 500 });
    }
}
