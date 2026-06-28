import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";

// Mock ssh2 before importing SshClient.
vi.mock("ssh2", () => ({ Client: vi.fn() }));

// Mock pkcs8-compat to control normalizeSshPrivateKey behaviour.
const { mockNormalize } = vi.hoisted(() => ({
    mockNormalize: vi.fn(),
}));

vi.mock("@/lib/ssh/pkcs8-compat", () => ({
    normalizeSshPrivateKey: mockNormalize,
}));

import { Client } from "ssh2";
import { SshClient } from "@/lib/ssh";

const MockClient = Client as unknown as ReturnType<typeof vi.fn>;

type MockInstance = EventEmitter & {
    connect: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
};

describe("SshClient - PKCS#8 encrypted key handling (lines 43-53)", () => {
    let mockInstance: MockInstance;

    beforeEach(() => {
        vi.clearAllMocks();
        mockInstance = Object.assign(new EventEmitter(), {
            connect: vi.fn(),
            end: vi.fn(),
        }) as MockInstance;
        MockClient.mockImplementation(function () { return mockInstance; });
    });

    const ENCRYPTED_KEY = "-----BEGIN ENCRYPTED PRIVATE KEY-----\nMIIFH...\n-----END ENCRYPTED PRIVATE KEY-----";
    const NORMALIZED_KEY = "-----BEGIN RSA PRIVATE KEY-----\nnormalized\n-----END RSA PRIVATE KEY-----";

    it("rejects with passphrase-required message when passphrase is missing", async () => {
        const client = new SshClient();
        const promise = client.connect({
            host: "h",
            username: "u",
            authType: "privateKey",
            privateKey: ENCRYPTED_KEY,
            // passphrase intentionally omitted
        });

        await expect(promise).rejects.toThrow(
            "This private key is passphrase-protected. Please provide the passphrase."
        );
        // normalizeSshPrivateKey must not be called.
        expect(mockNormalize).not.toHaveBeenCalled();
    });

    it("rejects with the thrown error when normalizeSshPrivateKey throws", async () => {
        mockNormalize.mockImplementation(() => {
            throw new Error("Bad passphrase");
        });

        const client = new SshClient();
        const promise = client.connect({
            host: "h",
            username: "u",
            authType: "privateKey",
            privateKey: ENCRYPTED_KEY,
            passphrase: "wrong",
        });

        await expect(promise).rejects.toThrow("Bad passphrase");
    });

    it("wraps non-Error throws from normalizeSshPrivateKey into an Error", async () => {
        mockNormalize.mockImplementation(() => {
            // eslint-disable-next-line @typescript-eslint/no-throw-literal
            throw "string error";
        });

        const client = new SshClient();
        const promise = client.connect({
            host: "h",
            username: "u",
            authType: "privateKey",
            privateKey: ENCRYPTED_KEY,
            passphrase: "wrong",
        });

        await expect(promise).rejects.toBeInstanceOf(Error);
        await expect(promise).rejects.toThrow("Failed to decrypt private key.");
    });

    it("uses the normalized key returned by normalizeSshPrivateKey on success", async () => {
        mockNormalize.mockReturnValue(NORMALIZED_KEY);

        const client = new SshClient();
        const promise = client.connect({
            host: "h",
            username: "u",
            authType: "privateKey",
            privateKey: ENCRYPTED_KEY,
            passphrase: "correct",
        });

        mockInstance.emit("ready");
        await promise;

        expect(mockNormalize).toHaveBeenCalledWith(ENCRYPTED_KEY, "correct");
        expect(mockInstance.connect).toHaveBeenCalledWith(
            expect.objectContaining({ privateKey: NORMALIZED_KEY })
        );
        // The passphrase itself should NOT be forwarded to ssh2 - the key is already decrypted.
        const callArg = mockInstance.connect.mock.calls[0][0];
        expect(callArg.passphrase).toBeUndefined();
    });
});
