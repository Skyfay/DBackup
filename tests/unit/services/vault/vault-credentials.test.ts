import { describe, expect, it } from "vitest";
import { buildCredentialsModel, type ListedProfile } from "@/services/vault/vault-credentials";
import type { CredentialAudit } from "@/services/vault/vault-audit";

const NOW = Date.parse("2026-09-27T12:00:00Z");

function use(overrides: Partial<ListedProfile["uses"][number]> = {}): ListedProfile["uses"][number] {
    return {
        id: "sftp",
        name: "SkyNas SFTP",
        adapterId: "sftp",
        type: "storage",
        storageRole: "DESTINATION",
        lastStatus: "ONLINE",
        lastHealthCheck: new Date("2026-09-27T11:59:00Z"),
        metadata: null,
        slot: "primary",
        ...overrides,
    };
}

function profile(overrides: Partial<ListedProfile> = {}): ListedProfile {
    return {
        id: "skynas",
        name: "SkyNas",
        type: "USERNAME_PASSWORD",
        description: null,
        createdAt: new Date("2026-06-26T10:00:00Z"),
        updatedAt: new Date("2026-06-26T10:00:00Z"),
        holds: "user admin",
        attention: null,
        uses: [],
        ...overrides,
    };
}

const NO_AUDIT: CredentialAudit = { reveals: new Map(), created: new Map(), changed: new Map(), revealRows: [] };

describe("buildCredentialsModel", () => {
    it("tells where each connection is listed and whether it answers", () => {
        const model = buildCredentialsModel(
            [profile({
                uses: [
                    use(),
                    use({ id: "photos", name: "Photos", storageRole: "SOURCE", lastStatus: "OFFLINE" }),
                    use({ id: "pg", name: "Shop", adapterId: "postgres", type: "database", storageRole: "DESTINATION", slot: "ssh", lastHealthCheck: null }),
                    use({ id: "mail", name: "Mail", adapterId: "email", type: "notification", storageRole: "DESTINATION" }),
                ],
            })],
            NO_AUDIT,
            90,
            NOW
        );

        expect(model.profiles[0].usedBy.map((connection) => [connection.id, connection.role, connection.slot, connection.status])).toEqual([
            ["sftp", "destination", "primary", "ONLINE"],
            ["photos", "source", "primary", "OFFLINE"],
            ["pg", "database", "ssh", null],
            ["mail", "notification", "primary", "ONLINE"],
        ]);
    });

    it("counts the profiles in use, the connections once each and the most common kind", () => {
        const shared = use();
        const model = buildCredentialsModel(
            [
                profile({ id: "a", uses: [shared] }),
                profile({ id: "b", type: "SSH_KEY", uses: [{ ...shared, slot: "ssh" }] }),
                profile({ id: "c" }),
            ],
            NO_AUDIT,
            90,
            NOW
        );

        expect(model.stats).toMatchObject({ profiles: 3, kinds: 2, topKind: "USERNAME_PASSWORD", inUse: 2, connections: 1, unused: 1 });
    });

    it("counts the reveals of the last 30 days and names the last one", () => {
        const audit: CredentialAudit = {
            ...NO_AUDIT,
            reveals: new Map([["skynas", { last: { at: "2026-09-24T09:00:00Z", by: "Manu" }, count: 2 }]]),
            revealRows: [
                { at: "2026-09-24T09:00:00Z", by: "Manu", profileId: "skynas" },
                { at: "2026-07-01T09:00:00Z", by: "Anna", profileId: "skynas" },
            ],
        };
        const model = buildCredentialsModel([profile()], audit, 90, NOW);

        expect(model.stats.revealed).toBe(1);
        expect(model.stats.lastReveal).toEqual({ at: "2026-09-24T09:00:00Z", by: "Manu", profile: "SkyNas" });
        expect(model.profiles[0]).toMatchObject({ reveals: 2, revealed: { by: "Manu" } });
    });
});
