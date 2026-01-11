import { NextRequest, NextResponse } from "next/server";
import { runJob } from "@/lib/runner";

export async function POST(
    req: NextRequest,
    { params }: { params: { id: string } }
) {
    const id = params.id;

    // We run this asynchronously to not block the UI if it takes long
    // But for feedback, we might want to await it if it's short.
    // Recommended: Trigger async, return "Started".
    // Ideally use a queue (BullMQ), but for this MVP, just float the promise.

    // However, Vercel/NextJS serverless functions might kill the process if response is sent.
    // Since this is likely a self-hosted tool (Local Backup Manager), we can try awaiting it
    // or assume the runtime keeps running.
    // Let's await it for now to provide immediate feedback on success/fail for the "Test Run".

    try {
        const result = await runJob(id);
        return NextResponse.json({ success: true, ...result });
    } catch (error: any) {
        return NextResponse.json(
            { success: false, error: error.message },
            { status: 500 }
        );
    }
}
