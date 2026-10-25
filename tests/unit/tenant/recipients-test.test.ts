import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";

const mocks = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock("@/lib/adapters", () => ({ registerAdapters: vi.fn() }));
vi.mock("@/lib/notifications/brand", () => ({ loadNotificationBrand: vi.fn(async () => ({ timeZone: "UTC" })) }));
vi.mock("@/services/notifications/channel-send", () => ({ sendThroughChannel: mocks.send }));
vi.mock("@/services/sharing/provided", () => ({
    isEmailChannel: (adapterId: string) => adapterId === "email",
    providedConnection: vi.fn(async () => ({ id: "acme-mail", name: "Mail", type: "notification", adapterId: "email", ownRecipients: true, providerName: "Acme Hosting" })),
}));
vi.mock("@/services/sharing/channel-recipients", () => ({ recipientsOf: vi.fn(async () => ["ops@globex.example"]) }));

const { sendRecipientsTest, TEST_COOLDOWN_MS } = await import("@/services/sharing/recipients-test");

beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.adapterConfig.findUnique.mockResolvedValue({ id: "acme-mail", tenantId: "acme", adapterId: "email", config: "{}" } as never);
});

describe("a test of the recipients of a channel another tenant shares", () => {
    it("goes out once a minute, since it sends through the mail server of that tenant", async () => {
        const start = 1_000_000;
        await expect(sendRecipientsTest("acme-mail", "globex", start)).resolves.toEqual({ name: "Mail", recipients: ["ops@globex.example"] });
        await expect(sendRecipientsTest("acme-mail", "globex", start + 5_000)).rejects.toThrow("Try again in a minute");
        expect(mocks.send).toHaveBeenCalledTimes(1);

        // Another tenant of the same channel waits for nobody else.
        await expect(sendRecipientsTest("acme-mail", "initech", start + 5_000)).resolves.toBeDefined();
        await expect(sendRecipientsTest("acme-mail", "globex", start + TEST_COOLDOWN_MS)).resolves.toBeDefined();
        expect(mocks.send).toHaveBeenCalledTimes(3);
    });

    it("lets only one of two tests at the same moment go out", async () => {
        const start = 5_000_000;
        const results = await Promise.allSettled([sendRecipientsTest("acme-mail", "hooli", start), sendRecipientsTest("acme-mail", "hooli", start + 1)]);
        expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
        expect(mocks.send).toHaveBeenCalledTimes(1);
    });

    it("lets the next test go out at once when one was refused before it sent", async () => {
        const start = 9_000_000;
        const { recipientsOf } = await import("@/services/sharing/channel-recipients");
        vi.mocked(recipientsOf).mockResolvedValueOnce([]);
        await expect(sendRecipientsTest("acme-mail", "umbrella", start)).rejects.toThrow("Name the recipients first");
        await expect(sendRecipientsTest("acme-mail", "umbrella", start + 1_000)).resolves.toBeDefined();
    });
});
