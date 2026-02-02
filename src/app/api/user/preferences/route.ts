import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

export async function GET() {
    const headersList = await headers();
    const session = await auth.api.getSession({ headers: headersList });

    if (!session?.user?.id) {
        return NextResponse.json({ autoRedirectOnJobStart: true }, { status: 200 });
    }

    try {
        const user = await prisma.user.findUnique({
            where: { id: session.user.id },
            select: { autoRedirectOnJobStart: true },
        });

        return NextResponse.json({
            autoRedirectOnJobStart: user?.autoRedirectOnJobStart ?? true,
        });
    } catch {
        return NextResponse.json({ autoRedirectOnJobStart: true }, { status: 200 });
    }
}
