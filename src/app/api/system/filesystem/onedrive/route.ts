import { NextRequest, NextResponse } from "next/server";
import { Client } from "@microsoft/microsoft-graph-client";
import { checkPermission } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getDecryptedCredentialData } from "@/services/auth/credential-service";
import type { OAuthData } from "@/lib/core/credentials";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";

const log = logger.child({ route: "system/filesystem/onedrive" });

// Microsoft OAuth token endpoint
const TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";

/**
 * POST /api/system/filesystem/onedrive
 * Browse OneDrive folders for the folder picker.
 *
 * Body: {
 *   credentialId: string, // OAUTH credential profile id
 *   folderPath?: string   // Folder to list ("" or undefined = root)
 * }
 *
 * Credentials are resolved server-side from the OAUTH credential profile - they
 * never travel through the client.
 *
 * Returns the same shape as the local/remote filesystem API:
 * { success, data: { currentPath, currentName, parentPath, entries: [{ name, type, path }] } }
 */
export async function POST(req: NextRequest) {
    try {
        await checkPermission(PERMISSIONS.DESTINATIONS.READ);

        const body = await req.json();
        const { credentialId, folderPath } = body;

        if (!credentialId) {
            return NextResponse.json({ success: false, error: "Missing credentialId" }, { status: 400 });
        }

        const config = (await getDecryptedCredentialData(credentialId, "OAUTH")) as OAuthData;

        if (!config?.clientId || !config?.clientSecret || !config?.refreshToken) {
            return NextResponse.json(
                { success: false, error: "OneDrive is not authorized. Please authorize first." },
                { status: 400 }
            );
        }

        // Get access token using refresh token
        const tokenRes = await fetch(TOKEN_URL, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                client_id: config.clientId,
                client_secret: config.clientSecret,
                refresh_token: config.refreshToken,
                grant_type: "refresh_token",
                scope: "Files.ReadWrite.All offline_access",
            }),
        });

        if (!tokenRes.ok) {
            return NextResponse.json(
                { success: false, error: `Failed to refresh token: ${tokenRes.status}` },
                { status: 401 }
            );
        }

        const tokenData = await tokenRes.json();

        const client = Client.init({
            authProvider: (done) => {
                done(null, tokenData.access_token);
            },
        });

        // Build the API path based on the folder path (avoid regex for user input - ReDoS safe)
        let currentPath = typeof folderPath === "string" ? folderPath : "";
        while (currentPath.startsWith("/")) currentPath = currentPath.slice(1);
        while (currentPath.endsWith("/")) currentPath = currentPath.slice(0, -1);
        const apiPath = currentPath
            ? `/me/drive/root:/${currentPath}:/children`
            : "/me/drive/root/children";

        // List only folders in the current location
        const allEntries: Array<{ name: string; type: string; path: string }> = [];
        let url: string | null = apiPath;

        while (url) {
            const res = await client.api(url)
                .select("id,name,folder")
                .filter("folder ne null")
                .top(200)
                .orderby("name")
                .get();

            for (const item of res.value || []) {
                if (item.folder) {
                    const itemPath = currentPath
                        ? `${currentPath}/${item.name}`
                        : item.name;
                    allEntries.push({
                        name: item.name,
                        type: "directory",
                        path: itemPath,
                    });
                }
            }

            url = res["@odata.nextLink"] || null;
        }

        // Determine parent path
        let parentPath: string | null = null;
        if (currentPath) {
            const parts = currentPath.split("/").filter(Boolean);
            if (parts.length > 1) {
                parentPath = parts.slice(0, -1).join("/");
            } else {
                parentPath = ""; // root
            }
        }

        // Current folder name
        const currentName = currentPath
            ? currentPath.split("/").filter(Boolean).pop() || "Root"
            : "OneDrive (Root)";

        return NextResponse.json({
            success: true,
            data: {
                currentPath,
                currentName,
                parentPath,
                entries: allEntries,
            },
        });
    } catch (err) {
        log.error("OneDrive folder browse failed", {}, wrapError(err));
        const message = err instanceof Error ? err.message : "Failed to browse OneDrive folders";
        return NextResponse.json(
            { success: false, error: message },
            { status: 500 }
        );
    }
}
