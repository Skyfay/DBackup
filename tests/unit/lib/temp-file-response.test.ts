// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { tempFileDownloadResponse } from "@/lib/server/temp-file-response";

let dir: string;

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "temp-file-response-"));
});

afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
});

function tempFile(name: string, content: Buffer | string): string {
    const file = path.join(dir, name);
    fs.writeFileSync(file, content);
    return file;
}

/** Waits until a condition holds, polling the event loop, or fails after a second. */
async function until(condition: () => boolean): Promise<void> {
    for (let i = 0; i < 100 && !condition(); i++) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(condition()).toBe(true);
}

describe("Temp file download response", () => {
    it("sends the file as an attachment with its size", () => {
        const file = tempFile("copy.db", "hello world");
        const response = tempFileDownloadResponse(file, "dbackup-database.db", "application/vnd.sqlite3");

        expect(response.headers.get("Content-Type")).toBe("application/vnd.sqlite3");
        expect(response.headers.get("Content-Length")).toBe("11");
        expect(response.headers.get("Content-Disposition")).toContain("dbackup-database.db");
        void response.body!.cancel();
    });

    it("sends the whole file and deletes it once it was sent", async () => {
        const file = tempFile("copy.db", "hello world");
        const response = tempFileDownloadResponse(file, "copy.db", "application/octet-stream");

        expect(await response.text()).toBe("hello world");
        await until(() => !fs.existsSync(file));
    });

    it("deletes the temp file when the browser cancels the download", async () => {
        const file = tempFile("big-backup.tar", Buffer.alloc(1024 * 1024));
        let stream: fs.ReadStream | undefined;
        const response = tempFileDownloadResponse(file, "big-backup.tar", "application/octet-stream", (s) => { stream = s; });

        await response.body!.cancel();

        expect(stream!.destroyed).toBe(true);
        await until(() => !fs.existsSync(file));
    });

    it("fails the download and deletes the temp file when reading it breaks off", async () => {
        const file = tempFile("broken.tar", Buffer.alloc(1024 * 1024));
        let stream: fs.ReadStream | undefined;
        const response = tempFileDownloadResponse(file, "broken.tar", "application/octet-stream", (s) => { stream = s; });
        const reader = response.body!.getReader();

        stream!.destroy(new Error("disk gone"));

        await expect((async () => { for (;;) if ((await reader.read()).done) return; })()).rejects.toThrow("disk gone");
        await until(() => !fs.existsSync(file));
    });

    it("reads no more of a large backup than a client that does not read takes", async () => {
        const size = 32 * 1024 * 1024;
        const file = tempFile("large.tar", Buffer.alloc(size));
        let stream: fs.ReadStream | undefined;
        const response = tempFileDownloadResponse(file, "large.tar", "application/octet-stream", (s) => { stream = s; });
        // A client that opened the download and stopped reading.
        const reader = response.body!.getReader();

        await new Promise((resolve) => setTimeout(resolve, 300));

        // One chunk in the body and the 64 KB the read stream buffers ahead, never the whole file.
        expect(stream!.bytesRead).toBeLessThanOrEqual(4 * 64 * 1024);

        // Reading on still delivers every byte.
        let received = 0;
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            received += value.length;
        }
        expect(received).toBe(size);
        await until(() => !fs.existsSync(file));
    });
});
