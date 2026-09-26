import { describe, expect, it } from "vitest";
import { checkOrder, copyRows, howText, lastCheckText, statusOf, summaryText } from "@/components/dashboard/storage/integrity/integrity-model";
import type { BackupCopy, ExplorerDestination, ExplorerFile } from "@/services/storage/explorer-types";

const MB = 1024 ** 2;
const bytes = (value: number) => `${Math.round(value / MB)} MB`;
const date = () => "26 Sep";
const file = (overrides: Partial<ExplorerFile> = {}) => ({ name: "a.tar", path: "Job/a.tar", size: 100 * MB, lastModified: "", checksum: "abc", ...overrides }) as ExplorerFile;
const destinations = new Map([
    ["nas", { id: "nas", name: "NAS", adapterId: "local-filesystem", checksNatively: true } as ExplorerDestination],
    ["box", { id: "box", name: "Box", adapterId: "sftp", checksNatively: false } as ExplorerDestination],
]);

describe("the copies in the integrity dialog", () => {
    it("tells a copy stored without a checksum from one that was never checked", () => {
        const [plain, old] = copyRows([
            { destinationId: "nas", state: "stored", file: file() },
            { destinationId: "box", state: "stored", file: file({ checksum: undefined, checksumMd5: undefined }) },
        ] as BackupCopy[], destinations);

        expect([statusOf(plain), statusOf(old)]).toEqual(["never", "unverifiable"]);
        expect(lastCheckText(old, undefined, date, bytes)).toBe("Stored without a checksum");
    });

    it("says how a copy is checked, and how it was the last time when that differs", () => {
        const [nas, box] = copyRows([
            { destinationId: "nas", state: "stored", file: file({ verification: { verifiedAt: "x", passed: true, trigger: "scheduled", method: "download" } }) },
            { destinationId: "box", state: "stored", file: file() },
        ] as BackupCopy[], destinations);

        expect(howText(nas, bytes)).toBe("Downloads 100 MB to hash it");
        expect(howText(box, bytes)).toBe("Downloads 100 MB to hash it");
        expect(lastCheckText(nas, undefined, date, bytes)).toBe("26 Sep · by the weekly check");
    });

    it("orders a check like the server, and counts what the copies say", () => {
        const rows = copyRows([{ destinationId: "box", state: "stored", file: file() }, { destinationId: "nas", state: "stored", file: file() }] as BackupCopy[], destinations);

        expect(checkOrder(rows).map((row) => row.destinationId)).toEqual(["nas", "box"]);
        expect(summaryText(["passed", "passed", "failed", "never", "missing"])).toBe("2 passed · 1 does not match · 1 not checked · 1 missing");
        expect(lastCheckText(rows[0], { destinationId: "box", file: "x", state: "waiting" }, date, bytes)).toBe("Waits for the ones before it");
    });
});
