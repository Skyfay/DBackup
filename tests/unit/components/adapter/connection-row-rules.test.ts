/**
 * The rows of the Connections page: a connection or a server of another tenant takes no part in a
 * bulk action, whose switches would not find it, and Create as directory source or destination
 * follows the limit of the kind it adds, not of the list it sits in.
 */
import { describe, expect, it } from "vitest";
import { counterpartRole, selectableForBulk } from "@/components/adapter/connection-row-rules";
import type { AdapterConfig } from "@/components/adapter/types";

const row = (fields: Partial<AdapterConfig> = {}): AdapterConfig => ({
    id: "nas", name: "NAS", adapterId: "local-filesystem", type: "storage", config: "{}", createdAt: "2026-10-01T00:00:00.000Z", storageRole: "DESTINATION", ...fields,
});

describe("bulk actions on the Connections page", () => {
    it("leave out a destination another tenant shares", () => {
        expect(selectableForBulk(row({ provided: { providerId: "default", providerName: "Platform", encryptedOnly: false, ownRecipients: false } }))).toBe(false);
    });

    it("leave out a server of another tenant and take an own connection", () => {
        expect(selectableForBulk(row({ sharedServer: {} as AdapterConfig["sharedServer"] }))).toBe(false);
        expect(selectableForBulk(row())).toBe(true);
    });
});

describe("Create as directory source or destination", () => {
    it("is offered on a destination only while the tenant may add directory sources", () => {
        expect(counterpartRole(row(), { directorySources: true, destinations: false })).toBe("SOURCE");
        expect(counterpartRole(row(), { directorySources: false, destinations: true })).toBeNull();
    });

    it("is offered on a directory source only while the tenant may add destinations", () => {
        const source = row({ storageRole: "SOURCE" });
        expect(counterpartRole(source, { directorySources: false, destinations: true })).toBe("DESTINATION");
        expect(counterpartRole(source, { directorySources: true, destinations: false })).toBeNull();
    });
});
