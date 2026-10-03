import { describe, expect, it } from "vitest";
import { BACKUP_STAGE_ORDER, INTEGRITY_CHECK_STAGE_ORDER, RESTORE_STAGE_ORDER, stageLabel } from "@/lib/core/logs";

describe("the name of a stage on a page", () => {
    it("shows every stage in sentence case, while the stored name stays", () => {
        expect(stageLabel("Dumping Databases")).toBe("Dumping databases");
        expect(stageLabel("Scanning Storage")).toBe("Scanning storage");
        expect(stageLabel("Uploading")).toBe("Uploading");
    });

    it("leaves no stage of a backup, a restore or a check with a capital in the middle", () => {
        for (const stage of [...BACKUP_STAGE_ORDER, ...RESTORE_STAGE_ORDER, ...INTEGRITY_CHECK_STAGE_ORDER]) {
            expect(stageLabel(stage).slice(1), stage).toBe(stageLabel(stage).slice(1).toLowerCase());
        }
    });
});
