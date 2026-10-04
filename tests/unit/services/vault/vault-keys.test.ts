import { describe, expect, it } from "vitest";
import { buildKeysModel, type KeyRecord, type ListedDestination } from "@/services/vault/vault-keys";
import type { KeyAudit } from "@/services/vault/vault-audit";

function key(overrides: Partial<KeyRecord> = {}): KeyRecord {
    return {
        id: "production",
        name: "Production",
        description: null,
        createdAt: new Date("2026-03-14T10:00:00Z"),
        updatedAt: new Date("2026-03-14T10:00:00Z"),
        keyId: "8a2f 91c3",
        kitDownloadedAt: null,
        aliases: [],
        jobs: [],
        configBackup: false,
        ...overrides,
    };
}

function file(name: string, profileId: string | undefined, createdAt = "2026-09-01T03:00:00Z", size = 100) {
    return { name, path: name, size, lastModified: new Date(createdAt), createdAt, jobName: "Shop", isEncrypted: profileId !== undefined, encryptionProfileId: profileId };
}

function destination(id: string, files: ListedDestination["files"]): ListedDestination {
    return { id, name: id.toUpperCase(), adapterId: "local-filesystem", files };
}

const NO_AUDIT: KeyAudit = { kits: [], reveals: new Map(), created: new Map() };

describe("buildKeysModel", () => {
    it("counts the backups of each key per destination, most first, and names its newest", () => {
        const model = buildKeysModel(
            [key(), key({ id: "offsite", name: "Offsite" })],
            [
                destination("nas", [file("a.tar", "production", "2026-09-01T03:00:00Z"), file("b.tar", "production", "2026-09-03T03:00:00Z"), file("plain.tar", undefined)]),
                destination("r2", [file("c.tar", "production", "2026-09-02T03:00:00Z"), file("d.tar", "production"), file("e.tar", "production")]),
            ],
            NO_AUDIT,
            90
        );

        const production = model.keys[0];
        expect(production.backups).toBe(5);
        expect(production.destinations.map((entry) => [entry.id, entry.count])).toEqual([["r2", 3], ["nas", 2]]);
        expect(production.recent[0]).toMatchObject({ name: "b.tar", destinationName: "NAS" });
        expect(model.keys[1].backups).toBe(0);
        expect(model.stats).toMatchObject({ backups: 6, encrypted: 5, keys: 2 });
    });

    it("puts backups whose key the Vault lacks apart, per destination", () => {
        const model = buildKeysModel(
            [key()],
            [destination("nas", [file("a.tar", "gone-1"), file("b.tar", "gone-2"), file("c.tar", "gone-1")]), destination("r2", [file("d.tar", "gone-1")])],
            NO_AUDIT,
            90
        );

        expect(model.stats.missing).toEqual({
            count: 4,
            keys: 2,
            destinations: [
                { id: "nas", name: "NAS", adapterId: "local-filesystem", count: 3 },
                { id: "r2", name: "R2", adapterId: "local-filesystem", count: 1 },
            ],
        });
        expect(model.keys[0].backups).toBe(0);
    });

    it("counts the backups of a profile that is gone under the key that opened them", () => {
        const model = buildKeysModel(
            [key({ aliases: ["deleted-profile"] })],
            [destination("nas", [file("a.tar", "deleted-profile"), file("b.tar", "production"), file("c.tar", "unknown")])],
            NO_AUDIT,
            90
        );

        expect(model.keys[0].backups).toBe(2);
        expect(model.stats.missing).toMatchObject({ count: 1, keys: 1 });
    });

    it("takes the kit from the key and who made it from the audit entry of the same moment", () => {
        const at = new Date("2026-09-15T08:00:00Z");
        const audit: KeyAudit = {
            ...NO_AUDIT,
            kits: [{ at: "2026-09-15T08:00:02Z", by: "Manu", profileIds: ["production", "offsite"] }],
        };
        const model = buildKeysModel([key({ kitDownloadedAt: at })], [], audit, 90);

        expect(model.keys[0].kit).toEqual({ at: at.toISOString(), by: "Manu", keys: 2 });
        expect(model.stats.lastKit).toEqual(model.keys[0].kit);
    });

    it("keeps the kit of a key when the audit log has forgotten it, without saying who", () => {
        const at = new Date("2026-01-02T08:00:00Z");
        const audit: KeyAudit = { ...NO_AUDIT, kits: [{ at: "2026-09-15T08:00:00Z", by: "Manu", profileIds: ["production"] }] };
        const model = buildKeysModel([key({ kitDownloadedAt: at })], [], audit, 90);

        expect(model.keys[0].kit).toEqual({ at: at.toISOString(), by: null, keys: null });
    });

    it("falls back to the audit log for a kit from before the key noted it, and lists the keys never in one", () => {
        const audit: KeyAudit = { ...NO_AUDIT, kits: [{ at: "2026-09-15T08:00:00Z", by: "Manu", profileIds: ["production"] }] };
        const model = buildKeysModel([key(), key({ id: "offsite", name: "Offsite" })], [], audit, 90);

        expect(model.keys[0].kit).toEqual({ at: "2026-09-15T08:00:00Z", by: "Manu", keys: 1 });
        expect(model.keys[1].kit).toBeNull();
        expect(model.stats.neverInKit).toEqual(["Offsite"]);
    });

    it("counts a key as in use for a job or the config backup", () => {
        const job = { id: "j1", name: "Shop nightly", enabled: true, schedule: "0 3 * * *", sourceType: "postgres", hasFolders: false };
        const model = buildKeysModel(
            [key({ jobs: [job, { ...job, id: "j2" }] }), key({ id: "config", configBackup: true }), key({ id: "idle" })],
            [],
            NO_AUDIT,
            90
        );

        expect(model.stats).toMatchObject({ jobs: 2, keysInUse: 2 });
    });

    it("hands on the reveal and the creator from the audit log", () => {
        const audit: KeyAudit = {
            kits: [],
            reveals: new Map([["production", { last: { at: "2026-09-20T10:00:00Z", by: "Manu" }, count: 3 }]]),
            created: new Map([["production", { at: "2026-03-14T10:00:00Z", by: "Anna" }]]),
        };
        const model = buildKeysModel([key()], [], audit, 30);

        expect(model.keys[0]).toMatchObject({ revealed: { by: "Manu" }, created: { by: "Anna" } });
        expect(model.auditDays).toBe(30);
    });
});
