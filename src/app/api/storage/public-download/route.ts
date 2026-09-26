import { NextRequest, NextResponse } from "next/server";
import { Readable } from "stream";
import { registerAdapters } from "@/lib/adapters";
import { storageService } from "@/services/storage/storage-service";
import { openArchiveDownload } from "@/services/restore/archive-download";
import { auditService } from "@/services/audit-service";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { claimLinkToken, markTokenUsed, releaseLinkToken } from "@/lib/auth/download-tokens";
import path from "path";
import os from "os";
import fs from "fs";
import fsPromises from "fs/promises";
import { attachmentDisposition } from "@/lib/server/content-disposition";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";

const log = logger.child({ route: "storage/public-download" });
registerAdapters();

/** The host a link was fetched from, as the proxy in front of DBackup reports it. */
function requesterOf(req: NextRequest): string | undefined {
    return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || undefined;
}

/**
 * Spends the link once the last byte left, and hands it back when the transfer broke off, so
 * the same command can simply run again within the five minutes.
 */
function settleWhenDone(stream: NodeJS.ReadableStream, token: string, onFetched: () => void): void {
    let finished = false;
    stream.on("end", () => {
        finished = true;
        onFetched();
    });
    stream.on("close", () => {
        if (!finished) releaseLinkToken(token);
    });
    stream.on("error", () => releaseLinkToken(token));
}

/**
 * Public download endpoint using temporary tokens
 *
 * This endpoint does NOT require authentication. It is public on purpose, for wget, curl or
 * PowerShell on a host without a session, and serves only what a single-use token from the
 * download-url endpoint names, which an authenticated user with the download right made.
 *
 * Tokens expire after 5 minutes and work for one complete download.
 */
export async function GET(req: NextRequest) {
    let tempFile: string | null = null;
    let claimed: string | null = null;

    try {
        const token = new URL(req.url).searchParams.get("token");
        if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400 });

        const tokenData = claimLinkToken(token);
        if (!tokenData) {
            log.debug("Token invalid, expired, spent or in use");
            return NextResponse.json({ error: "This link is spent or ran out. Make a new one in DBackup." }, { status: 401 });
        }
        claimed = token;

        const from = requesterOf(req);
        const { storageId, file, decrypt, database, pick, createdBy } = tokenData;
        const fetched = () => {
            markTokenUsed(token, from);
            if (createdBy) {
                void auditService.log(createdBy, AUDIT_ACTIONS.EXPORT, AUDIT_RESOURCES.DESTINATION,
                    { action: "download_link", file, databases: pick?.databases, selections: pick?.selections, from }, storageId);
            }
        };

        if (pick) {
            // Streamed like a browser download of the same pick, so the first byte leaves at
            // once and nothing waits on the disk of this host.
            const download = await openArchiveDownload({
                storageConfigId: storageId, file, databases: pick.databases, selections: pick.selections, target: { kind: "download" },
                ...(pick.profileIdOverride ? { keyOverride: { profileId: pick.profileIdOverride } } : {}),
            });
            settleWhenDone(download.stream, token, fetched);
            return new NextResponse(Readable.toWeb(download.stream as Readable) as ReadableStream, {
                headers: {
                    "Content-Disposition": attachmentDisposition(download.fileName),
                    "Content-Type": download.contentType,
                    ...(download.contentLength !== undefined ? { "Content-Length": String(download.contentLength) } : {}),
                    "Cache-Control": "no-store",
                },
            });
        }

        tempFile = path.join(os.tmpdir(), `${path.basename(file)}_${Date.now()}`);
        const result = await storageService.downloadFile(storageId, file, tempFile, decrypt, { database });
        if (!result.success) {
            await fsPromises.unlink(tempFile).catch(() => {});
            releaseLinkToken(token);
            return NextResponse.json({ error: "Download failed" }, { status: 500 });
        }

        const stat = await fsPromises.stat(tempFile);

        // Determine filename. A dump pulled out of a seekable archive arrives already named.
        let downloadFilename = path.basename(file);
        if (result.fileName) {
            downloadFilename = result.fileName;
        } else if (result.isZip) {
            downloadFilename = downloadFilename.replace(/\.enc$/, "") + ".zip";
            if (!downloadFilename.endsWith(".zip")) downloadFilename += ".zip";
        } else if (decrypt && downloadFilename.endsWith(".enc")) {
            downloadFilename = downloadFilename.slice(0, -4);
        }

        const localFile = tempFile;
        const fileStream = fs.createReadStream(localFile);
        settleWhenDone(fileStream, token, fetched);
        fileStream.on("close", () => { fsPromises.unlink(localFile).catch(() => {}); });

        return new NextResponse(Readable.toWeb(fileStream) as ReadableStream, {
            headers: {
                "Content-Disposition": attachmentDisposition(downloadFilename),
                "Content-Type": result.isZip ? "application/zip" : "application/octet-stream",
                "Content-Length": String(stat.size),
            }
        });
    } catch (error: unknown) {
        if (tempFile) await fsPromises.unlink(tempFile).catch(() => {});
        if (claimed) releaseLinkToken(claimed);

        log.error("Public download error", {}, wrapError(error));
        return NextResponse.json({ error: "Download failed" }, { status: 500 });
    }
}
