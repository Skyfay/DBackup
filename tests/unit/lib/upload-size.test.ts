// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../../../next.config";
import { CONFIG_UPLOAD_MAX_BYTES } from "@/lib/core/config-upload";
import { formLimitFor, readFormWithin } from "@/lib/server/upload-size";

const BOUNDARY = "----dbackup-test";
const CHUNK = 16 * 1024;

/** A multipart body with one file of `size` bytes, as its raw bytes. */
function multipart(size: number): Uint8Array {
    const head = new TextEncoder().encode(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="a.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`);
    const tail = new TextEncoder().encode(`\r\n--${BOUNDARY}--\r\n`);
    const body = new Uint8Array(head.length + size + tail.length);
    body.set(head, 0);
    body.set(tail, head.length + size);
    return body;
}

/** A request whose body arrives in chunks without a Content-Length, like `Transfer-Encoding: chunked`, counting what was pulled. */
function chunked(body: Uint8Array) {
    const pulled = { bytes: 0, cancelled: false };
    let offset = 0;
    const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
            if (offset >= body.length) return controller.close();
            const chunk = body.slice(offset, offset + CHUNK);
            offset += chunk.length;
            pulled.bytes = offset;
            controller.enqueue(chunk);
        },
        cancel() {
            pulled.cancelled = true;
        },
    });
    const request = new Request("http://localhost/upload", {
        method: "POST",
        body: stream,
        headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
        duplex: "half",
    } as RequestInit);
    return { request, pulled };
}

describe("reading the form of an upload within a limit", () => {
    it("reads a form sent in chunks without a Content-Length while it stays within the limit", async () => {
        const { request } = chunked(multipart(100 * 1024));
        expect(request.headers.get("content-length")).toBeNull();

        const read = await readFormWithin(request, formLimitFor(1024 * 1024));

        expect(read.tooLarge).toBe(false);
        expect((read.form?.get("file") as File).size).toBe(100 * 1024);
    });

    it("cuts a chunked body off past the limit and never reads the rest of it", async () => {
        const body = multipart(8 * 1024 * 1024);
        const { request, pulled } = chunked(body);

        const read = await readFormWithin(request, formLimitFor(1024 * 1024));

        expect(read).toEqual({ form: null, tooLarge: true });
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(pulled.cancelled).toBe(true);
        expect(pulled.bytes).toBeLessThan(2 * 1024 * 1024);
    });

    it("refuses a body that announces more than the limit before reading a byte", async () => {
        const { request } = chunked(multipart(10));
        const announced = new Request(request, { headers: { "content-length": String(50 * 1024 * 1024), "content-type": request.headers.get("content-type")! } });

        expect(await readFormWithin(announced, formLimitFor(1024 * 1024))).toEqual({ form: null, tooLarge: true });
        expect(announced.bodyUsed).toBe(false);
    });

    it("answers no form, but not too large, for a body that is no form or none at all", async () => {
        expect(await readFormWithin(new Request("http://localhost/upload", { method: "POST", body: "plain text" }), 1024)).toEqual({ form: null, tooLarge: false });
        expect(await readFormWithin(new Request("http://localhost/upload", { method: "POST" }), 1024)).toEqual({ form: null, tooLarge: false });
    });
});

describe("the upload routes", () => {
    const API = path.resolve(__dirname, "../../../src/app/api");
    const routes = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        return entry.isDirectory() ? routes(full) : entry.name === "route.ts" ? [full] : [];
    });

    it("read a form only through readFormWithin, so no body without a Content-Length is read in full", () => {
        const direct = routes(API).filter((file) => /\.formData\(\)/.test(fs.readFileSync(file, "utf8"))).map((file) => path.relative(API, file));
        expect(direct, "Read the form with readFormWithin from @/lib/server/upload-size").toEqual([]);
    });

    it("get the body past the middleware above the largest upload, so the route answers 413 rather than a cut off file", () => {
        expect(Number(nextConfig.experimental?.proxyClientMaxBodySize)).toBeGreaterThan(CONFIG_UPLOAD_MAX_BYTES);
    });
});
