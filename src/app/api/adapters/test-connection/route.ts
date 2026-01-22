import { NextRequest, NextResponse } from "next/server";
import { registry } from "@/lib/core/registry";
import { registerAdapters } from "@/lib/adapters";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import prisma from "@/lib/prisma";

// Ensure adapters are registered
registerAdapters();

export async function POST(req: NextRequest) {
    const session = await auth.api.getSession({
        headers: await headers()
    });

    if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const body = await req.json();
        const { adapterId, config, configId } = body;

        if (!adapterId || !config) {
            return NextResponse.json({ success: false, message: "Missing required fields" }, { status: 400 });
        }

        const adapter = registry.get(adapterId);

        if (!adapter) {
            return NextResponse.json({ success: false, message: "Adapter not found" }, { status: 404 });
        }

        if (!adapter.test) {
            return NextResponse.json({ success: false, message: "This adapter does not support connection testing." });
        }

        const result = await adapter.test(config);

        // If test successful and we have a configId (editing existing config), update metadata
        if (result.success && result.version && configId) {
            try {
                const existingConfig = await prisma.adapterConfig.findUnique({
                    where: { id: configId },
                    select: { metadata: true }
                });

                const currentMeta = existingConfig?.metadata ? JSON.parse(existingConfig.metadata) : {};
                const newMeta = {
                    ...currentMeta,
                    engineVersion: result.version,
                    lastCheck: new Date().toISOString(),
                    status: 'Online'
                };

                await prisma.adapterConfig.update({
                    where: { id: configId },
                    data: { metadata: JSON.stringify(newMeta) }
                });
            } catch (metaError) {
                console.error('[TestConnection] Failed to update metadata:', metaError);
                // Don't fail the entire request if metadata update fails
            }
        }

        return NextResponse.json(result);

    } catch (error: any) {
        return NextResponse.json({ success: false, message: error.message }, { status: 500 });
    }
}
