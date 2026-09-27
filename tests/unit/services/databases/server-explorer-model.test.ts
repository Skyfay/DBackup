import { describe, expect, it } from "vitest";
import { behindOf, inPeriod, versionPeriods } from "@/services/databases/server-explorer-model";

const at = (iso: string) => new Date(iso);

describe("the versions a server ran", () => {
    it("lists them newest first, each until the next came, with how it came", () => {
        const periods = versionPeriods([
            { previousVersion: "16.2", newVersion: "16.4", detectedAt: at("2026-09-17T02:14:00Z") },
            { previousVersion: null, newVersion: "15.6", detectedAt: at("2025-11-12T03:10:00Z") },
            { previousVersion: "15.6", newVersion: "16.2", detectedAt: at("2026-03-03T01:40:00Z") },
        ], "16.4");

        expect(periods.map((period) => period.version)).toEqual(["16.4", "16.2", "15.6"]);
        expect(periods[0]).toMatchObject({ until: null, change: { kind: "up", from: "16.2" } });
        expect(periods[1]).toMatchObject({ since: "2026-03-03T01:40:00.000Z", until: "2026-09-17T02:14:00.000Z" });
        // The first version was read when the server was added.
        expect(periods[2].change).toBeNull();
    });

    it("marks a version older than the one before as a rollback", () => {
        const [latest] = versionPeriods([
            { previousVersion: null, newVersion: "15.5", detectedAt: at("2025-07-28T02:10:00Z") },
            { previousVersion: "15.5", newVersion: "15.4", detectedAt: at("2025-07-30T14:20:00Z") },
        ], "15.4");

        expect(latest.change).toEqual({ kind: "down", from: "15.5" });
    });

    it("has the version read now for a server without a history yet", () => {
        expect(versionPeriods([], "8.0.39")).toEqual([{ version: "8.0.39", since: null, until: null, change: null }]);
        expect(versionPeriods([], null)).toEqual([]);
    });

    it("counts a moment into the version that ran then, up to the next one", () => {
        const period = { since: "2026-03-03T00:00:00Z", until: "2026-09-17T00:00:00Z" };
        expect(inPeriod(period, Date.parse("2026-05-01T00:00:00Z"))).toBe(true);
        expect(inPeriod(period, Date.parse("2026-09-17T00:00:00Z"))).toBe(false);
        expect(inPeriod({ since: null, until: null }, Date.parse("2020-01-01T00:00:00Z"))).toBe(true);
    });
});

describe("a server too old for the backups of its engine", () => {
    const servers = [
        { id: "shop", name: "Shop cluster", adapterId: "postgres", version: "16.4" },
        { id: "staging", name: "Staging", adapterId: "postgres", version: "16.2" },
        { id: "replica", name: "Shop replica", adapterId: "postgres", version: "16.6" },
        { id: "crm", name: "CRM", adapterId: "mysql", version: "8.0.36" },
    ];
    const kept = [
        { serverId: "shop", createdAt: "2026-09-26T03:00:00Z", engineVersion: "16.4" },
        { serverId: "staging", createdAt: "2026-09-20T03:00:00Z", engineVersion: "16.2" },
        { serverId: "crm", createdAt: "2026-09-26T03:00:00Z", engineVersion: "8.0.39" },
    ];

    it("names the newest kept backup of its engine it cannot take, and the server that made it", () => {
        expect(behindOf(servers[1], servers, kept)).toEqual({ version: "16.4", serverName: "Shop cluster" });
        expect(behindOf(servers[0], servers, kept)).toBeNull();
        // Shop replica runs a newer version than any backup.
        expect(behindOf(servers[2], servers, kept)).toBeNull();
    });

    it("counts its own backups of a newer version too, like after a rollback", () => {
        expect(behindOf(servers[3], servers, kept)).toEqual({ version: "8.0.39", serverName: "CRM" });
    });
});
