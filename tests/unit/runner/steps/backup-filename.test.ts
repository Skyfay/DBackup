/**
 * A naming pattern names one file, the archive of a run inside the folder of that run. A pattern
 * like `../../backups/OtherJob/other` once pointed the archive at a file outside it, which the run
 * truncated, wrote and then deleted in its cleanup. A save refuses such a pattern, and the runner
 * keeps the name to one part for a pattern saved before the rule.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "path";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { ValidationError } from "@/lib/logging/errors";
import { resolveBackupFilename } from "@/lib/runner/steps/dump-helpers";
import { NAMING_PATTERN_RULE, namingPatternProblem } from "@/lib/templates/naming-pattern";
import { createNamingTemplate, updateNamingTemplate } from "@/services/templates/naming-template-service";
import type { JobWithRelations } from "@/lib/runner/types";

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const ESCAPING = ["../../backups/VictimJob/victim", "a/../../x", "..\\x", "/abs/x", "..", ".hidden", "x\u0000y", "line\nbreak"];
const RUN_DIR = path.resolve("/tmp/dbackup-run-abc123");
const job = { name: "Attacker Job", databases: "[]", namingTemplateId: "tpl-1" } as unknown as JobWithRelations;

function pattern(value: string | null, setting: string | null = null) {
    prismaMock.namingTemplate.findUnique.mockResolvedValue(value === null ? null : ({ id: "tpl-1", pattern: value } as never));
    prismaMock.systemSetting.findUnique.mockImplementation((async (args: { where: { key: string } }) =>
        args.where.key === "system.filenamePattern" && setting !== null ? { key: args.where.key, value: setting } : null) as never);
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe("the archive a run writes", () => {
    it.each(ESCAPING)("stays directly inside the folder of the run for the pattern %j", async (value) => {
        pattern(value);

        const { tempFile, fileName } = await resolveBackupFilename(job, undefined, RUN_DIR);

        expect(path.dirname(path.resolve(tempFile))).toBe(RUN_DIR);
        expect(fileName).not.toMatch(/[\\/\x00-\x1f]|^\./);
    });

    it("stays inside it for a file name pattern of the settings as well", async () => {
        pattern(null, "../../etc/x");

        const { tempFile } = await resolveBackupFilename(job, undefined, RUN_DIR);

        expect(path.dirname(path.resolve(tempFile))).toBe(RUN_DIR);
    });

    it("keeps the name of a pattern that names one file", async () => {
        pattern("{job_name}_backup.v1");

        const { fileName } = await resolveBackupFilename(job, undefined, RUN_DIR);

        expect(fileName).toBe("Attacker_Job_backup.v1.tar");
    });
});

describe("a naming pattern that names more than one file", () => {
    it.each(ESCAPING)("is refused on save: %j", async (value) => {
        expect(namingPatternProblem(value)).toBe(NAMING_PATTERN_RULE);
        await expect(createNamingTemplate({ name: "Evil", pattern: value })).rejects.toBeInstanceOf(ValidationError);
        await expect(updateNamingTemplate("tpl-1", { pattern: value })).rejects.toThrow(NAMING_PATTERN_RULE);
        expect(prismaMock.namingTemplate.create).not.toHaveBeenCalled();
        expect(prismaMock.namingTemplate.update).not.toHaveBeenCalled();
    });

    it("is not what a pattern of one file is", () => {
        for (const value of ["{job_name}_yyyy-MM-dd_HH-mm-ss_{chain}", "release..notes_{db_name}", "nightly.yyyy"]) {
            expect(namingPatternProblem(value)).toBeNull();
        }
    });
});
