// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "http";
import type { AddressInfo } from "net";
import { createClient } from "webdav";
import { listDavFolder } from "@/lib/adapters/storage/webdav-listing";
import { ListingTooLargeError } from "@/lib/adapters/storage/common/listing-limits";

/**
 * A WebDAV server in this process, the way Nextcloud answers: the connection URL has a base path,
 * every `href` repeats it, names are percent-encoded and the folder lists itself first.
 */
const BASE = "/remote.php/dav/files/admin";

function entry(href: string, folder: boolean, size = 0): string {
    return `<d:response><d:href>${href}</d:href><d:propstat><d:prop>` +
        `<d:getlastmodified>Mon, 26 Oct 2026 10:00:00 GMT</d:getlastmodified>` +
        (folder ? "<d:resourcetype><d:collection/></d:resourcetype>" : `<d:resourcetype/><d:getcontentlength>${size}</d:getcontentlength>`) +
        `</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
}

function multistatus(entries: string[]): string {
    return `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${entries.join("")}</d:multistatus>`;
}

const LISTING = multistatus([
    entry(`${BASE}/backups/`, true),
    entry(`${BASE}/backups/Job%20A/`, true),
    entry(`${BASE}/backups/nightly%20%C3%A4.tar`, false, 1234),
    entry(`https://dav.example.com${BASE}/backups/full.tar.meta.json`, false, 56),
]);

let server: http.Server;
let url: string;
/** What the server sends for the next PROPFIND: a body, or a stream of chunks without end. */
let answer: { body: string; announce?: number } | { endless: true } = { body: LISTING };
let bytesSent = 0;

beforeAll(async () => {
    server = http.createServer((req, res) => {
        req.resume();
        if (req.method !== "PROPFIND") {
            res.writeHead(405).end();
            return;
        }
        if ("endless" in answer) {
            res.writeHead(207, { "Content-Type": "application/xml" });
            const chunk = Buffer.alloc(64 * 1024, "x");
            const push = () => {
                while (!res.destroyed && res.write(chunk)) bytesSent += chunk.length;
                if (!res.destroyed) res.once("drain", push);
            };
            res.on("close", () => res.removeAllListeners("drain"));
            push();
            return;
        }
        const headers: Record<string, string | number> = { "Content-Type": "application/xml" };
        if (answer.announce !== undefined) headers["Content-Length"] = answer.announce;
        res.writeHead(207, headers);
        res.end(answer.announce !== undefined ? "" : answer.body);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}${BASE}`;
});

afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
});

describe("the listing of a WebDAV folder", () => {
    it("names the entries exactly as the library does", async () => {
        answer = { body: LISTING };
        const client = createClient(url, { username: "admin", password: "pw" });

        const ours = await listDavFolder(client, url, "/backups");
        const library = await client.getDirectoryContents("/backups");

        expect(ours).toEqual(library);
        expect(ours.map((item) => [item.filename, item.basename, item.type, item.size])).toEqual([
            ["/backups/Job A", "Job A", "directory", 0],
            ["/backups/nightly ä.tar", "nightly ä.tar", "file", 1234],
            ["/backups/full.tar.meta.json", "full.tar.meta.json", "file", 56],
        ]);
    });

    it("refuses an answer the server announces as larger than the limit before reading it", async () => {
        answer = { body: "", announce: 4096 };
        const client = createClient(url, { username: "admin", password: "pw" });

        await expect(listDavFolder(client, url, "/backups", 1024)).rejects.toBeInstanceOf(ListingTooLargeError);
    });

    it("stops reading an answer without end at the limit", async () => {
        answer = { endless: true };
        bytesSent = 0;
        const client = createClient(url, { username: "admin", password: "pw" });

        await expect(listDavFolder(client, url, "/backups", 256 * 1024)).rejects.toBeInstanceOf(ListingTooLargeError);
        // Socket buffers hold some more, but the transfer ended near the limit, not at the end of anything.
        expect(bytesSent).toBeLessThan(64 * 1024 * 1024);
    });
});
