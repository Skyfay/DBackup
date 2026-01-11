import { NextRequest, NextResponse } from "next/server";
import { registry } from "@/lib/core/registry";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { adapterId, config } = body;

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

        return NextResponse.json(result);

    } catch (error: any) {
        return NextResponse.json({ success: false, message: error.message }, { status: 500 });
    }
}
