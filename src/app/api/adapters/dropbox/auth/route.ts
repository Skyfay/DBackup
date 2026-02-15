import { NextRequest, NextResponse } from "next/server";
import { DropboxAuth } from "dropbox";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import prisma from "@/lib/prisma";
import { checkPermission } from "@/lib/access-control";
import { PERMISSIONS } from "@/lib/permissions";
import { decryptConfig } from "@/lib/crypto";
import { logger } from "@/lib/logger";

const log = logger.child({ route: "adapters/dropbox/auth" });

/**
 * POST /api/adapters/dropbox/auth
 * Generates the Dropbox OAuth authorization URL.
 * Body: { adapterId: string } — The saved adapter config ID to authorize.
 */
export async function POST(req: NextRequest) {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        await checkPermission(PERMISSIONS.DESTINATIONS.WRITE);

        const { adapterId } = await req.json();
        if (!adapterId) {
            return NextResponse.json({ error: "Missing adapterId" }, { status: 400 });
        }

        // Load the adapter config to get clientId and clientSecret
        const adapterConfig = await prisma.adapterConfig.findUnique({
            where: { id: adapterId },
        });

        if (!adapterConfig || adapterConfig.adapterId !== "dropbox") {
            return NextResponse.json({ error: "Adapter not found or not a Dropbox adapter" }, { status: 404 });
        }

        const config = decryptConfig(JSON.parse(adapterConfig.config));

        if (!config.clientId || !config.clientSecret) {
            return NextResponse.json({ error: "App Key and App Secret are required" }, { status: 400 });
        }

        // Build callback URL from the request origin
        const origin = req.nextUrl.origin;
        const redirectUri = `${origin}/api/adapters/dropbox/callback`;

        const dbxAuth = new DropboxAuth({
            clientId: config.clientId,
            clientSecret: config.clientSecret,
            fetch: fetch,
        });

        const authUrl = await dbxAuth.getAuthenticationUrl(
            redirectUri,
            adapterId, // state parameter for callback
            "code",
            "offline", // Request offline access to get refresh_token
            undefined, // scopes — use app-configured scopes
            "none",
            false
        );

        log.info("Generated Dropbox OAuth URL", { adapterId });

        return NextResponse.json({ success: true, data: { authUrl: String(authUrl) } });
    } catch (error) {
        log.error("Failed to generate Dropbox OAuth URL", {}, error instanceof Error ? error : undefined);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : "Failed to generate auth URL" },
            { status: 500 }
        );
    }
}
