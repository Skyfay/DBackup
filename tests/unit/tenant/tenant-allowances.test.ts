import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { runAsSystem, runAsTenant } from "@/lib/tenant/context";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import { allowanceKindOf, assertMayAdd, assertMayAddKind, setAllowances } from "@/services/tenant/tenant-allowances";

vi.mock("@/lib/server/request-headers", () => ({ requestHeaders: vi.fn().mockRejectedValue(new Error("outside a request")) }));

const row = (overrides: Partial<Record<"addsDatabases" | "addsDirectorySources" | "addsDestinations" | "addsChannels" | "addsApiKeys", boolean>> = {}) => ({
    name: "Globex",
    addsDatabases: true,
    addsDirectorySources: true,
    addsDestinations: true,
    addsChannels: true,
    addsApiKeys: true,
    ...overrides,
});

beforeEach(() => {
    prismaMock.tenant.findUnique.mockImplementation((async (args: { where: { id: string } }) =>
        args.where.id === HOME_TENANT_ID ? { name: "Acme Hosting" } : row({ addsDestinations: false })) as never);
});

describe("what a tenant may add itself", () => {
    it("refuses a new destination of a tenant the platform keeps from adding one, naming who decides", async () => {
        await expect(runAsTenant("globex", () => assertMayAdd("storage", "DESTINATION"))).rejects.toThrow(
            "Globex adds no destinations of its own. Acme Hosting decides that, ask them for one.",
        );
    });

    it("counts a storage connection without a role as a destination, the default of the column", async () => {
        await expect(runAsTenant("globex", () => assertMayAdd("storage", null))).rejects.toThrow("adds no destinations");
    });

    it("still lets it add the kinds the platform leaves to it", async () => {
        await expect(runAsTenant("globex", () => assertMayAdd("storage", "SOURCE"))).resolves.toBeUndefined();
        await expect(runAsTenant("globex", () => assertMayAdd("database"))).resolves.toBeUndefined();
        await expect(runAsTenant("globex", () => assertMayAdd("notification"))).resolves.toBeUndefined();
    });

    it("refuses a new API key of a tenant the platform keeps from making one", async () => {
        prismaMock.tenant.findUnique.mockImplementation((async (args: { where: { id: string } }) =>
            args.where.id === HOME_TENANT_ID ? { name: "Acme Hosting" } : row({ addsApiKeys: false })) as never);
        await expect(runAsTenant("globex", () => assertMayAddKind("apiKeys"))).rejects.toThrow("Globex makes no API keys. Acme Hosting decides that.");
        await expect(runAsTenant("globex", () => assertMayAdd("database"))).resolves.toBeUndefined();
    });

    it("refuses nothing outside a tenant, like a restore of the configuration", async () => {
        await expect(runAsSystem(() => assertMayAdd("storage", "DESTINATION"))).resolves.toBeUndefined();
        expect(prismaMock.tenant.findUnique).not.toHaveBeenCalled();
    });

    it("maps every kind of connection to its limit", () => {
        expect(allowanceKindOf("database")).toBe("databases");
        expect(allowanceKindOf("notification")).toBe("channels");
        expect(allowanceKindOf("storage", "SOURCE")).toBe("directorySources");
        expect(allowanceKindOf("storage", "DESTINATION")).toBe("destinations");
        expect(allowanceKindOf("unknown")).toBeNull();
    });
});

describe("changing what a tenant may add", () => {
    it("never limits the home tenant, which holds what the platform owns", async () => {
        await expect(setAllowances(HOME_TENANT_ID, { destinations: false })).rejects.toThrow("home tenant");
        expect(prismaMock.tenant.update).not.toHaveBeenCalled();
    });

    it("changes only the kinds it is given and reports before and after", async () => {
        prismaMock.tenant.update.mockResolvedValue({} as never);
        const result = await setAllowances("globex", { channels: false });
        expect(result.before).toEqual({ databases: true, directorySources: true, destinations: false, channels: true, apiKeys: true });
        expect(result.after).toEqual({ databases: true, directorySources: true, destinations: false, channels: false, apiKeys: true });
        expect(prismaMock.tenant.update).toHaveBeenCalledWith({
            where: { id: "globex" },
            data: { addsDatabases: true, addsDirectorySources: true, addsDestinations: false, addsChannels: false, addsApiKeys: true },
        });
    });
});
