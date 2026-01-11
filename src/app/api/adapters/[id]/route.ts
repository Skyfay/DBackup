import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function DELETE(
    req: NextRequest,
    props: { params: Promise<{ id: string }> }
) {
    const params = await props.params;
    try {
        await prisma.adapterConfig.delete({
            where: { id: params.id },
        });
        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ error: "Failed to delete adapter" }, { status: 500 });
    }
}

export async function PUT(
    req: NextRequest,
    props: { params: Promise<{ id: string }> }
) {
    const params = await props.params;
    try {
        const body = await req.json();
        const { name, config } = body;

        const configString = typeof config === 'string' ? config : JSON.stringify(config);

        const updatedAdapter = await prisma.adapterConfig.update({
            where: { id: params.id },
            data: {
                name,
                config: configString
            }
        });
        return NextResponse.json(updatedAdapter);
    } catch (error) {
        return NextResponse.json({ error: "Failed to update adapter" }, { status: 500 });
    }
}
