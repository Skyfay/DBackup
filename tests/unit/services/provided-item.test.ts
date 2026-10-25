/**
 * What a customer reads of a destination or a channel another tenant shares with it, in its lists
 * and pickers: whether it is online and when it was checked, never why it fails, how fast it
 * answers or anything of its settings but whether it is air-gapped.
 */
import { describe, expect, it, vi } from "vitest";
import type { ProvidedConnection } from "@/services/sharing/provided";

vi.mock("@/services/sharing/channel-recipients", () => ({ recipientsOf: vi.fn(async () => []) }));
vi.mock("@/lib/adapters/dto", () => ({ getAdapterOptions: vi.fn(async () => []) }));

const { providedItem } = await import("@/services/sharing/connection-options");

const checked = new Date("2026-10-20T10:00:00Z");
const nas: ProvidedConnection = {
    id: "acme-nas", name: "NAS", type: "storage", adapterId: "sftp", storageRole: "DESTINATION",
    metadata: JSON.stringify({ airGapped: true, host: "nas.acme.internal", note: "rack 4" }),
    lastStatus: "OFFLINE", lastHealthCheck: checked, createdAt: checked, updatedAt: checked,
    providerId: "acme", providerName: "Acme Hosting", allTenants: false, encryptedOnly: false, ownRecipients: false,
};

describe("a destination another tenant shares, as its customer lists it", () => {
    it("carries its state and the time of its last check, and of its settings only that it is air-gapped", async () => {
        const item = await providedItem(nas, "globex");

        expect(item).toMatchObject({ lastStatus: "OFFLINE", lastHealthCheck: checked, lastError: null, consecutiveFailures: 0, config: "{}" });
        expect(JSON.parse(item.metadata!)).toEqual({ airGapped: true });
    });

    it("says a destination is not air-gapped when its tenant never switched it on", async () => {
        const item = await providedItem({ ...nas, metadata: JSON.stringify({ host: "nas.acme.internal" }) }, "globex");
        expect(JSON.parse(item.metadata!)).toEqual({ airGapped: false });
    });

    it("carries no settings of a channel", async () => {
        const item = await providedItem({ ...nas, id: "acme-chat", type: "notification", adapterId: "discord", metadata: JSON.stringify({ team: "ops" }) }, "globex");
        expect(item.metadata).toBeNull();
    });
});
