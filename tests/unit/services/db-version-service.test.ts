import { describe, it, expect, vi, beforeEach } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";

vi.mock("@/lib/logging/logger", () => ({
    logger: {
        child: () => ({
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        }),
    },
}));

vi.mock("@/lib/logging/errors", () => ({
    wrapError: vi.fn((e: unknown) => e),
}));

import { recordVersionIfChanged, listVersionHistory } from "@/services/system/db-version-service";

const SOURCE_ID = "src-1";

function makeRow(version: string, edition: string | null = null) {
    return {
        id: "row",
        adapterConfigId: SOURCE_ID,
        previousVersion: null,
        newVersion: version,
        edition,
        detectedAt: new Date(),
    };
}

describe("db-version-service", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("recordVersionIfChanged", () => {
        it("inserts initial row when no history exists (changed=true, previousVersion=null)", async () => {
            prismaMock.dbVersionHistory.findFirst.mockResolvedValue(null);
            prismaMock.dbVersionHistory.create.mockResolvedValue(makeRow("8.0.36") as never);

            const result = await recordVersionIfChanged(SOURCE_ID, "8.0.36");

            expect(result).toEqual({ changed: true, previousVersion: null, newVersion: "8.0.36", isDowngrade: false });
            expect(prismaMock.dbVersionHistory.create).toHaveBeenCalledWith({
                data: {
                    adapterConfigId: SOURCE_ID,
                    previousVersion: null,
                    newVersion: "8.0.36",
                    edition: null,
                },
            });
        });

        it("is a no-op when the latest stored version matches", async () => {
            prismaMock.dbVersionHistory.findFirst.mockResolvedValue(makeRow("8.0.36") as never);

            const result = await recordVersionIfChanged(SOURCE_ID, "8.0.36");

            expect(result).toEqual({ changed: false, previousVersion: "8.0.36", newVersion: "8.0.36", isDowngrade: false });
            expect(prismaMock.dbVersionHistory.create).not.toHaveBeenCalled();
        });

        it("inserts a new row on version change with previousVersion populated", async () => {
            prismaMock.dbVersionHistory.findFirst.mockResolvedValue(makeRow("8.0.36") as never);
            prismaMock.dbVersionHistory.create.mockResolvedValue(makeRow("8.0.37") as never);

            const result = await recordVersionIfChanged(SOURCE_ID, "8.0.37");

            expect(result).toEqual({ changed: true, previousVersion: "8.0.36", newVersion: "8.0.37", isDowngrade: false });
            expect(prismaMock.dbVersionHistory.create).toHaveBeenCalledWith({
                data: {
                    adapterConfigId: SOURCE_ID,
                    previousVersion: "8.0.36",
                    newVersion: "8.0.37",
                    edition: null,
                },
            });
        });

        it("treats whitespace-only differences as no change (normalization)", async () => {
            prismaMock.dbVersionHistory.findFirst.mockResolvedValue(makeRow("15.2") as never);

            const result = await recordVersionIfChanged(SOURCE_ID, "  15.2  ");

            expect(result.changed).toBe(false);
            expect(prismaMock.dbVersionHistory.create).not.toHaveBeenCalled();
        });

        it("treats an empty version string as no-op (does not insert)", async () => {
            const result = await recordVersionIfChanged(SOURCE_ID, "   ");

            expect(result.changed).toBe(false);
            expect(prismaMock.dbVersionHistory.findFirst).not.toHaveBeenCalled();
            expect(prismaMock.dbVersionHistory.create).not.toHaveBeenCalled();
        });

        it("detects an edition change as a versioned change even when version is identical", async () => {
            prismaMock.dbVersionHistory.findFirst.mockResolvedValue(makeRow("16.0.4135.4", "Developer") as never);
            prismaMock.dbVersionHistory.create.mockResolvedValue(makeRow("16.0.4135.4", "Standard") as never);

            const result = await recordVersionIfChanged(SOURCE_ID, "16.0.4135.4", "Standard");

            expect(result.changed).toBe(true);
            expect(prismaMock.dbVersionHistory.create).toHaveBeenCalledWith({
                data: {
                    adapterConfigId: SOURCE_ID,
                    previousVersion: "16.0.4135.4",
                    newVersion: "16.0.4135.4",
                    edition: "Standard",
                },
            });
        });

        it("returns changed=false when the insert itself fails", async () => {
            prismaMock.dbVersionHistory.findFirst.mockResolvedValue(null);
            prismaMock.dbVersionHistory.create.mockRejectedValue(new Error("DB down"));

            const result = await recordVersionIfChanged(SOURCE_ID, "1.0.0");

            expect(result.changed).toBe(false);
            expect(result.newVersion).toBe("1.0.0");
        });
    });

    describe("listVersionHistory", () => {
        it("returns entries ordered desc and clamps the limit", async () => {
            prismaMock.dbVersionHistory.findMany.mockResolvedValue([] as never);

            await listVersionHistory(SOURCE_ID, 9999);

            expect(prismaMock.dbVersionHistory.findMany).toHaveBeenCalledWith({
                where: { adapterConfigId: SOURCE_ID },
                orderBy: { detectedAt: "desc" },
                take: 500,
            });
        });

        it("clamps non-positive limits to 1", async () => {
            prismaMock.dbVersionHistory.findMany.mockResolvedValue([] as never);

            await listVersionHistory(SOURCE_ID, 0);

            expect(prismaMock.dbVersionHistory.findMany).toHaveBeenCalledWith(
                expect.objectContaining({ take: 1 })
            );
        });
    });
});
