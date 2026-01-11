import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type");

    try {
        const adapters = await prisma.adapterConfig.findMany({
            where: type ? { type } : undefined,
            orderBy: { createdAt: 'desc' }
        });
        return NextResponse.json(adapters);
    } catch (error) {
        return NextResponse.json({ error: "Failed to fetch adapters" }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { name, type, adapterId, config } = body;

        // Basic validation
        if (!name || !type || !adapterId || !config) {
            return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
        }

        // Ensure config is string
        const configString = typeof config === 'string' ? config : JSON.stringify(config);

        const newAdapter = await prisma.adapterConfig.create({
            data: {
                name,
                type,
                adapterId,
                config: configString,
            },
        });

        return NextResponse.json(newAdapter, { status: 201 });
    } catch (error) {
        console.error("Create error:", error);
        return NextResponse.json({ error: "Failed to create adapter" }, { status: 500 });
    }
}
