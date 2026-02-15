import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import prisma from "@/lib/prisma";
import { checkPermission } from "@/lib/access-control";
import { PERMISSIONS } from "@/lib/permissions";
import { decryptConfig } from "@/lib/crypto";
import { logger } from "@/lib/logger";

const log = logger.child({ route: "adapters/onedrive/auth" });

const SCOPES = [
    "Files.ReadWrite.All",
    "offline_access",
    "User.Read",
];

/**
 * POST /api/adapters/onedrive/auth
 * Generates the Microsoft OAuth authorization URL.
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

        if (!adapterConfig || adapterConfig.adapterId !== "onedrive") {
            return NextResponse.json({ error: "Adapter not found or not a OneDrive adapter" }, { status: 404 });
        }

        const config = decryptConfig(JSON.parse(adapterConfig.config));

        if (!config.clientId || !config.clientSecret) {
            return NextResponse.json({ error: "Client ID and Client Secret are required" }, { status: 400 });
        }

        // Build callback URL from the request origin
        const origin = req.nextUrl.origin;
        const redirectUri = `${origin}/api/adapters/onedrive/callback`;

        const authUrl = new URL("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
        authUrl.searchParams.set("client_id", config.clientId);
        authUrl.searchParams.set("response_type", "code");
        authUrl.searchParams.set("redirect_uri", redirectUri);
        authUrl.searchParams.set("scope", SCOPES.join(" "));
        authUrl.searchParams.set("response_mode", "query");
        authUrl.searchParams.set("prompt", "consent"); // Force consent to always get refresh_token
        authUrl.searchParams.set("state", adapterId); // Pass adapter config ID as state for callback

        log.info("Generated Microsoft OAuth URL", { adapterId });

        return NextResponse.json({ success: true, data: { authUrl: authUrl.toString() } });
    } catch (error) {
        log.error("Failed to generate Microsoft OAuth URL", {}, error instanceof Error ? error : undefined);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : "Failed to generate auth URL" },
            { status: 500 }
        );
    }
}
