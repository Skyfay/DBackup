
import { NextRequest, NextResponse } from "next/server";
import { registry } from "@/lib/core/registry";
import { registerAdapters } from "@/lib/adapters";
import { StorageAdapter, DatabaseAdapter } from "@/lib/core/interfaces";
import prisma from "@/lib/prisma";
import path from "path";
import os from "os";
import fs from "fs";

registerAdapters();

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const params = await props.params;
    let tempFile: string | null = null;
    try {
        const body = await req.json();
        const { file } = body;

        if (!file) {
            return NextResponse.json({ error: "Missing file" }, { status: 400 });
        }

        const storageConfig = await prisma.adapterConfig.findUnique({ where: { id: params.id } });
        if (!storageConfig || storageConfig.type !== "storage") {
            return NextResponse.json({ error: "Storage adapter not found" }, { status: 404 });
        }

        const storageAdapter = registry.get(storageConfig.adapterId) as StorageAdapter;
        if (!storageAdapter) return NextResponse.json({ error: "Storage impl missing" }, { status: 500 });

        // This relies on MySQL Adapter (or any DB adapter) to analyze the file.
        // But here we don't know the SOURCE adapter type yet because it's just a file.
        // However, we can use the MySQL adapter specifically to inspect, or assume common SQL format.
        // Better: frontend should tell us what KIND of backup this is (e.g. from the source extension).
        // But for now, we'll try to use the MySQL adapter logic since we know it's likely MySQL based on user context.
        // Ideally, we'd have a generic "SQL Analyzer" or rely on the filename extension.

        // To properly support this generically, we should accept a "type" parameter or try all adapters.
        // For this MVP, we will instantiate the MySQL adapter temporarily just to use its static-like logic,
        // OR better: we define a utility function. But since the logic is inside the adapter `analyzeDump`, we need an instance.
        // Let's use the `mysql` adapter ID hardcoded for inspection if file ends in .sql?
        // Or cleaner: The user selects "Restore to Source X". We use Source X to inspect the file.
        // But the inspection happens BEFORE selecting target source in the ideal flow?
        // Let's assume the user selects target source FIRST in the UI? Or we just download and peek.

        // Simpler flow for now: Just download to temp and try to detect known formats.

        const tempDir = os.tmpdir();
        tempFile = path.join(tempDir, path.basename(file));
        const sConf = JSON.parse(storageConfig.config);

        const downloadSuccess = await storageAdapter.download(sConf, file, tempFile);
        if (!downloadSuccess) return NextResponse.json({ error: "Download failed" }, { status: 500 });

        // Instantiate MySQL Adapter to check
        // In a real app we'd need to know the type.
        const mysqlAdapter = registry.get("mysql") as DatabaseAdapter;

        let databases: string[] = [];
        if (mysqlAdapter && mysqlAdapter.analyzeDump) {
            databases = await mysqlAdapter.analyzeDump(tempFile);
        }

        return NextResponse.json({ databases });

    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        if (tempFile && fs.existsSync(tempFile)) {
            try { fs.unlinkSync(tempFile); } catch {}
        }
    }
}
