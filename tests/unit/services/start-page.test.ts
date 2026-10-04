import { describe, it, expect } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { hasNothingToBackUp } from "@/services/dashboard/start-page";
import { canUseQuickSetup } from "@/lib/auth/sign-in-target";
import { PERMISSIONS } from "@/lib/auth/permissions";

describe("where someone starts after signing in", () => {
    it("sends a fresh instance to the Quick Setup", async () => {
        prismaMock.adapterConfig.count.mockResolvedValue(0);
        prismaMock.job.count.mockResolvedValue(0);

        expect(await hasNothingToBackUp()).toBe(true);
        // A notification channel alone backs nothing up, so only databases and storage count.
        expect(prismaMock.adapterConfig.count).toHaveBeenCalledWith({ where: { type: { in: ["database", "storage"] } } });
    });

    it("keeps the Overview once there is a connection to back up from or to", async () => {
        prismaMock.adapterConfig.count.mockResolvedValue(1);
        prismaMock.job.count.mockResolvedValue(0);

        expect(await hasNothingToBackUp()).toBe(false);
    });

    it("keeps the Overview once there is a job", async () => {
        prismaMock.adapterConfig.count.mockResolvedValue(0);
        prismaMock.job.count.mockResolvedValue(2);

        expect(await hasNothingToBackUp()).toBe(false);
    });

    it("offers the Quick Setup only to someone who may add a source, a destination and a job", () => {
        const all = [PERMISSIONS.SOURCES.WRITE, PERMISSIONS.DESTINATIONS.WRITE, PERMISSIONS.JOBS.WRITE];

        expect(canUseQuickSetup(all)).toBe(true);
        expect(canUseQuickSetup(all.slice(0, 2))).toBe(false);
        expect(canUseQuickSetup([])).toBe(false);
    });
});
