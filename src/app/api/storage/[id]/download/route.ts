
import { NextRequest, NextResponse } from "next/server";
import { registry } from "@/lib/core/registry";
import { registerAdapters } from "@/lib/adapters";
import { StorageAdapter } from "@/lib/core/interfaces";
import { decryptConfig } from "@/lib/crypto";
import prisma from "@/lib/prisma";
import path from "path";
import os from "os";
import fs from "fs";

registerAdapters();

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const params = await props.params;
    let tempFile: string | null = null;

    try {
        const { searchParams } = new URL(req.url);
        const file = searchParams.get("file");

        if (!file) {
             return NextResponse.json({ error: "Missing file param" }, { status: 400 });
        }

        const adapterConfig = await prisma.adapterConfig.findUnique({
            where: { id: params.id }
        });

        if (!adapterConfig || adapterConfig.type !== "storage") {
            return NextResponse.json({ error: "not found" }, { status: 404 });
        }

        const adapter = registry.get(adapterConfig.adapterId) as StorageAdapter;
        const config = decryptConfig(JSON.parse(adapterConfig.config));

        const tempDir = os.tmpdir();
        tempFile = path.join(tempDir, path.basename(file));

        const success = await adapter.download(config, file, tempFile);
        if (!success) {
             return NextResponse.json({ error: "Download failed" }, { status: 500 });
        }

        // Stream file back
        const fileBuffer = fs.readFileSync(tempFile);

        // Clean up immediately? No, need to send it.
        // readFileSync loads into memory. Not efficient for large files, but easiest for Next.js Route Handlers currently without streams overhead.

        fs.unlinkSync(tempFile); // We have buffer

        return new NextResponse(fileBuffer, {
            headers: {
                "Content-Disposition": `attachment; filename="${path.basename(file)}"`,
                "Content-Type": "application/octet-stream",
            }
        });

    } catch (error: any) {
        if (tempFile && fs.existsSync(tempFile)) {
             try { fs.unlinkSync(tempFile); } catch {}
        }
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
