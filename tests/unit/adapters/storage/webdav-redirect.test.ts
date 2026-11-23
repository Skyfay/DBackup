// @vitest-environment node
/**
 * The webdav client follows a redirect on its own, but asks the agents of its connection for
 * every socket. Those agents open one only to the host of the configured URL, so a redirect to
 * another host fails instead of reaching a host the local network check never read, and a
 * redirect on the same host keeps working. The servers here listen on the loopback of the test.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createClient } from "webdav";
import { webdavAgents } from "@/lib/adapters/storage/webdav-agents";

const servers: http.Server[] = [];

async function serve(handler: http.RequestListener): Promise<number> {
    const server = http.createServer(handler);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return (server.address() as AddressInfo).port;
}

/** A PROPFIND answer for one file, what `stat` reads. */
const MULTISTATUS = `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>/dav/file.txt</d:href><d:propstat><d:prop><d:getlastmodified>Sun, 18 Oct 2026 10:00:00 GMT</d:getlastmodified><d:getcontentlength>4</d:getcontentlength><d:resourcetype/></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`;

afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

describe("the agents of a WebDAV connection", () => {
    it("refuse a socket to another host than the one of the URL", async () => {
        const { httpAgent, httpsAgent } = webdavAgents("cloud.example.com");
        for (const agent of [httpAgent, httpsAgent]) {
            const connect = (agent as unknown as { createConnection: (options: object, callback: (error: Error | null) => void) => unknown }).createConnection;
            const error = await new Promise<Error | null>((resolve) => {
                connect({ host: "10.0.0.5", port: 80 }, resolve);
            });
            expect(error?.message).toContain("sent DBackup on to 10.0.0.5, which it does not follow");
        }
    });

    it("stop the client at a redirect to another host", async () => {
        let reachedOther = false;
        const other = await serve((_req, res) => {
            reachedOther = true;
            res.writeHead(207, { "content-type": "application/xml" }).end(MULTISTATUS);
        });
        const first = await serve((_req, res) => {
            // localhost is the same machine, but another host than the URL names.
            res.writeHead(301, { location: `http://localhost:${other}/dav/file.txt` }).end();
        });

        const client = createClient(`http://127.0.0.1:${first}/dav`, { username: "u", password: "p", ...webdavAgents("127.0.0.1") });

        await expect(client.stat("/file.txt")).rejects.toThrow(/does not follow/);
        expect(reachedOther).toBe(false);
    });

    it("let the client follow a redirect on the same host and read as before", async () => {
        const port = await serve((req, res) => {
            if (req.url === "/dav/file.txt") return void res.writeHead(301, { location: "/dav/moved/file.txt" }).end();
            res.writeHead(207, { "content-type": "application/xml" }).end(MULTISTATUS);
        });

        const client = createClient(`http://127.0.0.1:${port}/dav`, { username: "u", password: "p", ...webdavAgents("127.0.0.1") });

        await expect(client.stat("/file.txt")).resolves.toMatchObject({ basename: "file.txt", size: 4 });
    });
});
