/**
 * A backup of a shared database belongs to a customer only when the customer held the database for
 * the whole time it was being made, from when its run started to dump until its sidecar was stamped.
 * A dump of one customer's time stored after the database changed hands goes to nobody.
 */
import { describe, expect, it, vi } from "vitest";
import type { OwnerFacts, ServerBackupFile } from "@/services/tenant/shared-backups";

vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/services/storage/storage-service", () => ({ storageService: {} }));
vi.mock("@/services/sharing/provided", () => ({ providedTo: vi.fn() }));

const { sharedBackupsOf } = await import("@/services/tenant/shared-backups");

const at = (time: string) => new Date(`2026-11-02T${time}:00.000Z`);
const T0 = "01:00";
const T1 = "01:10";
const T2 = "01:15";
const STORED = "01:20";

/** A backup of crm whose run started to dump at `dumped` and whose sidecar was stamped at `stored`. */
function backup(stored: string, dumped?: string): ServerBackupFile {
    return {
        destinationId: "nas",
        file: {
            name: "crm.tar", path: "Nightly/crm.tar", size: 1, lastModified: at(stored), createdAt: at(stored).toISOString(),
            databases: ["crm", "other"], sourceId: "srv-1", hasFileIndex: true,
            ...(dumped ? { dumpsStartedAt: at(dumped).toISOString() } : {}),
        },
    };
}

/** X held crm until T1, Y from T1 on, as assign() writes a handover. */
const HANDOVER: OwnerFacts = {
    assignments: [
        { databaseName: "crm", tenantId: "x", validFrom: new Date("2026-05-01T00:00:00.000Z"), validUntil: at(T1), createdAt: new Date("2026-05-01T00:00:00.000Z") },
        { databaseName: "crm", tenantId: "y", validFrom: at(T1), validUntil: null, createdAt: at(T1) },
    ],
    rules: [],
};

const seen = (facts: OwnerFacts, file: ServerBackupFile) => ({
    x: sharedBackupsOf("x", "srv-1", "crm", [file], facts).length,
    y: sharedBackupsOf("y", "srv-1", "crm", [file], facts).length,
});

describe("who a shared backup belongs to", () => {
    it("gives a dump made before a handover and stored after it to neither customer", () => {
        expect(seen(HANDOVER, backup(STORED, T0))).toEqual({ x: 0, y: 0 });
    });

    it("gives it to neither when the database went to another customer and came back while the run went on", () => {
        const facts: OwnerFacts = {
            assignments: [
                { ...HANDOVER.assignments[0] },
                { databaseName: "crm", tenantId: "y", validFrom: at(T1), validUntil: at(T2), createdAt: at(T1) },
                { databaseName: "crm", tenantId: "x", validFrom: at(T2), validUntil: null, createdAt: at(T2) },
            ],
            rules: [],
        };

        expect(seen(facts, backup(STORED, T0))).toEqual({ x: 0, y: 0 });
    });

    it("gives it to neither when a rule that gave the database ended while the run went on", () => {
        const facts: OwnerFacts = {
            assignments: [],
            rules: [
                { id: "r-x", pattern: "crm*", tenantId: "x", priority: 10, validFrom: new Date("2026-05-01T00:00:00.000Z"), validUntil: at(T1), createdAt: new Date("2026-05-01T00:00:00.000Z") },
                { id: "r-y", pattern: "crm*", tenantId: "y", priority: 0, validFrom: new Date("2026-05-01T00:00:00.000Z"), validUntil: null, createdAt: new Date("2026-05-01T00:00:00.000Z") },
            ],
        };

        expect(seen(facts, backup(STORED, T0))).toEqual({ x: 0, y: 0 });
    });

    it("gives a backup whose run started after the handover to the new customer, and one made before it to the old", () => {
        expect(seen(HANDOVER, backup(STORED, T2))).toEqual({ x: 0, y: 1 });
        expect(seen(HANDOVER, backup("01:05", T0))).toEqual({ x: 1, y: 0 });
    });

    it("judges a backup whose sidecar names no dump start by its stamp, as before", () => {
        expect(seen(HANDOVER, backup(STORED))).toEqual({ x: 0, y: 1 });
    });
});
