// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";

class FakeReadStream extends EventEmitter {
    destroy = vi.fn();
}

let stream: FakeReadStream;
const unlink = vi.fn();

vi.mock("fs", () => {
    const api = {
        statSync: () => ({ size: 11 }),
        createReadStream: () => stream,
    };
    return { default: api, ...api };
});
vi.mock("fs/promises", () => {
    const api = { unlink: (...a: unknown[]) => unlink(...a) };
    return { default: api, ...api };
});

const { tempFileDownloadResponse } = await import("@/lib/server/temp-file-response");

describe("Temp file download response", () => {
    beforeEach(() => {
        stream = new FakeReadStream();
        unlink.mockReset().mockResolvedValue(undefined);
    });

    it("sends the file as an attachment with its size", () => {
        const response = tempFileDownloadResponse("/tmp/copy.db", "dbackup-database.db", "application/vnd.sqlite3");

        expect(response.headers.get("Content-Type")).toBe("application/vnd.sqlite3");
        expect(response.headers.get("Content-Length")).toBe("11");
        expect(response.headers.get("Content-Disposition")).toContain("dbackup-database.db");
    });

    it("deletes the temp file once it was sent", async () => {
        const response = tempFileDownloadResponse("/tmp/copy.db", "copy.db", "application/octet-stream");
        const reader = response.body!.getReader();

        stream.emit("data", Buffer.from("hello world"));
        stream.emit("end");
        await reader.read();

        expect(unlink).toHaveBeenCalledWith("/tmp/copy.db");
    });

    it("deletes the temp file when the browser cancels the download", async () => {
        const response = tempFileDownloadResponse("/tmp/big-backup.tar", "big-backup.tar", "application/octet-stream");

        await response.body!.cancel();

        expect(stream.destroy).toHaveBeenCalled();
        expect(unlink).toHaveBeenCalledWith("/tmp/big-backup.tar");
    });
});
