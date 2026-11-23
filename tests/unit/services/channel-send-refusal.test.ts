// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ValidationError } from "@/lib/logging/errors";

const mocks = vi.hoisted(() => ({
    resolve: vi.fn(),
    record: vi.fn(),
    send: vi.fn(),
}));

vi.mock("@/lib/core/registry", () => ({ registry: { get: () => ({ send: mocks.send }) } }));
vi.mock("@/lib/adapters/config-resolver", () => ({ resolveAdapterConfig: (...args: unknown[]) => mocks.resolve(...args) }));
vi.mock("@/services/notifications/notification-log-service", () => ({ recordNotificationLog: (...args: unknown[]) => mocks.record(...args) }));
vi.mock("@/services/sharing/channel-recipients", () => ({ channelTarget: async () => ({}) }));
vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const { sendThroughChannel, SHARED_FAILURE } = await import("@/services/notifications/channel-send");

const REFUSAL = "Acme Hosting reaches no address of the local network, mail.internal is 10.0.0.25.";
const channel = { id: "acme-mail", name: "Mail", adapterId: "email", config: "{}", primaryCredentialId: null, sshCredentialId: null, tenantId: "acme" };
const payload = { title: "Backup failed", message: "Shop nightly failed" } as never;

beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolve.mockRejectedValue(new ValidationError(REFUSAL));
});

describe("a channel whose settings are refused, like a host in a blocked local network", () => {
    it("fails a customer's message in words that name nothing of the tenant that shares it, and logs it", async () => {
        await expect(sendThroughChannel(channel, payload, "BACKUP_FAILURE", undefined, { tenantId: "globex" })).rejects.toThrow(SHARED_FAILURE);

        expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({ status: "Failed", error: SHARED_FAILURE, tenantId: "globex" }));
        expect(JSON.stringify(mocks.record.mock.calls)).not.toContain("10.0.0.25");
        expect(mocks.send).not.toHaveBeenCalled();
    });

    it("tells its own tenant why, logged as a failed send", async () => {
        await expect(sendThroughChannel(channel, payload, "BACKUP_FAILURE", undefined, { tenantId: "acme" })).rejects.toThrow(REFUSAL);

        expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({ status: "Failed", error: REFUSAL }));
    });
});
