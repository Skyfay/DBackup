
import { NextRequest, NextResponse } from "next/server";
import { registry } from "@/lib/core/registry";
import { registerAdapters } from "@/lib/adapters";
import { StorageAdapter, DatabaseAdapter } from "@/lib/core/interfaces";
import { decryptConfig } from "@/lib/crypto";
import prisma from "@/lib/prisma";
import path from "path";
import os from "os";
import fs from "fs";

registerAdapters();

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const params = await props.params;
    let tempFile: string | null = null;
    let executionId: string | null = null;

    try {
        const body = await req.json();
        const { file, targetSourceId, targetDatabaseName } = body;

        // Start Logging Execution
        const execution = await prisma.execution.create({
            data: {
                type: 'Restore',
                status: 'Running',
                logs: JSON.stringify([`Starting restore for ${file}`]),
                startedAt: new Date(),
                path: file
            }
        });
        executionId = execution.id;

        if (!file || !targetSourceId) {
            await prisma.execution.update({
                where: { id: executionId },
                data: { status: 'Failed', endedAt: new Date(), logs: JSON.stringify(["Missing file or targetSourceId"]) }
            });
            return NextResponse.json({ error: "Missing file or targetSourceId" }, { status: 400 });
        }

        // 1. Get Storage Adapter
        const storageConfig = await prisma.adapterConfig.findUnique({ where: { id: params.id } });
        if (!storageConfig || storageConfig.type !== "storage") {
             const msg = "Storage adapter not found";
             await prisma.execution.update({
                where: { id: executionId },
                data: { status: 'Failed', endedAt: new Date(), logs: JSON.stringify([msg]) }
            });
            return NextResponse.json({ error: msg }, { status: 404 });
        }

        const storageAdapter = registry.get(storageConfig.adapterId) as StorageAdapter;
        if (!storageAdapter) {
             const msg = "Storage impl missing";
             await prisma.execution.update({
                where: { id: executionId },
                data: { status: 'Failed', endedAt: new Date(), logs: JSON.stringify([msg]) }
            });
            return NextResponse.json({ error: msg }, { status: 500 });
        }

        // 2. Get Source Adapter
        const sourceConfig = await prisma.adapterConfig.findUnique({ where: { id: targetSourceId } });
        if (!sourceConfig || sourceConfig.type !== "database") {
             const msg = "Source adapter not found";
             await prisma.execution.update({
                where: { id: executionId },
                data: { status: 'Failed', endedAt: new Date(), logs: JSON.stringify([msg]) }
            });
            return NextResponse.json({ error: msg }, { status: 404 });
        }

        const sourceAdapter = registry.get(sourceConfig.adapterId) as DatabaseAdapter;
        if (!sourceAdapter) {
             const msg = "Source impl missing";
             await prisma.execution.update({
                where: { id: executionId },
                data: { status: 'Failed', endedAt: new Date(), logs: JSON.stringify([msg]) }
            });
            return NextResponse.json({ error: msg }, { status: 500 });
        }

        // 3. Download File
        const tempDir = os.tmpdir();
        tempFile = path.join(tempDir, path.basename(file));

        const sConf = decryptConfig(JSON.parse(storageConfig.config));
        const downloadSuccess = await storageAdapter.download(sConf, file, tempFile);

        if (!downloadSuccess) {
            const msg = "Failed to download file from storage";
             await prisma.execution.update({
                where: { id: executionId },
                data: { status: 'Failed', endedAt: new Date(), logs: JSON.stringify([msg]) }
            });
            return NextResponse.json({ error: msg }, { status: 500 });
        }

        // 4. Restore
        const dbConf = decryptConfig(JSON.parse(sourceConfig.config));

        // Override database name if provided
        if (targetDatabaseName) {
            dbConf.database = targetDatabaseName;
        }

        // Pass database mapping if provided
        if (body.databaseMapping) {
            dbConf.databaseMapping = body.databaseMapping;
        }

        // Add privileged auth if provided
        if (body.privilegedAuth) {
            dbConf.privilegedAuth = body.privilegedAuth;
        }

        const restoreResult = await sourceAdapter.restore(dbConf, tempFile);

        if (!restoreResult.success) {
            await prisma.execution.update({
                where: { id: executionId },
                data: {
                    status: 'Failed',
                    endedAt: new Date(),
                    logs: JSON.stringify(restoreResult.logs)
                }
            });
            return NextResponse.json({ error: restoreResult.error || "Restore failed", logs: restoreResult.logs }, { status: 500 });
        }

        await prisma.execution.update({
            where: { id: executionId },
            data: {
                status: 'Success',
                endedAt: new Date(),
                logs: JSON.stringify(restoreResult.logs)
            }
        });

        return NextResponse.json({ success: true, logs: restoreResult.logs });

    } catch (error: any) {
        console.error("Restore error:", error);
        if (executionId) {
             await prisma.execution.update({
                where: { id: executionId },
                data: { status: 'Failed', endedAt: new Date(), logs: JSON.stringify([`Error: ${error.message}`]) }
            });
        }
        return NextResponse.json({ error: error.message }, { status: 500 });
    } finally {
        if (tempFile && fs.existsSync(tempFile)) {
             try { fs.unlinkSync(tempFile); } catch {}
        }
    }
}
