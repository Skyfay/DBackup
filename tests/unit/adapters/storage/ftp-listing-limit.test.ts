import { describe, it, expect, vi } from "vitest";

/** Every client the adapter made, real basic-ftp clients that never connect. */
const { created } = vi.hoisted(() => ({ created: [] as { options: { maxListingBytes: number; allowSeparateTransferHost: boolean } }[] }));

vi.mock("basic-ftp", async (importOriginal) => {
    const actual = await importOriginal<typeof import("basic-ftp")>();
    class RecordingClient extends actual.Client {
        constructor(...args: ConstructorParameters<typeof actual.Client>) {
            super(...args);
            created.push(this as unknown as (typeof created)[number]);
        }
        override async access() { return { code: 220, message: "ok" }; }
        override async list() { return []; }
        override close() { }
    }
    return { ...actual, Client: RecordingClient };
});

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import { FTPAdapter, FTP_MAX_LISTING_BYTES } from "@/lib/adapters/storage/ftp";

describe("the listing of an FTP folder", () => {
    it("is read into memory only up to its limit, named by DBackup rather than left to the library", async () => {
        await FTPAdapter.list({ host: "ftp.example.com", port: 21, username: "u", password: "p", tls: false, pathPrefix: "" } as never, "");

        expect(created.length).toBeGreaterThan(0);
        for (const client of created) {
            expect(client.options.maxListingBytes).toBe(FTP_MAX_LISTING_BYTES);
            expect(client.options.allowSeparateTransferHost).toBe(false);
        }
        expect(FTP_MAX_LISTING_BYTES).toBe(40 * 1024 * 1024);
    });
});
