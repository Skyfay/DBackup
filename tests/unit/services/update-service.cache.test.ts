import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { version as CURRENT_VERSION } from "../../../package.json";

const prisma = vi.hoisted(() => ({ systemSetting: { findUnique: vi.fn() } }));

vi.mock("@/lib/prisma", () => ({ default: prisma }));
vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const [major] = CURRENT_VERSION.split(".").map(Number);
const NEWER = `v${major + 1}.0.0`;
const MINUTE = 60 * 1000;

const tags = (...names: string[]) => ({ ok: true, json: async () => names.map((name) => ({ name })) });

/** The service with nothing checked yet, as after a start. */
async function freshService() {
    vi.resetModules();
    return (await import("@/services/system/update-service")).updateService;
}

/** Lets the check that runs in the background finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("what the dashboard shows about a new version", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers({ now: new Date("2026-10-01T12:00:00.000Z"), toFake: ["Date"] });
        prisma.systemSetting.findUnique.mockResolvedValue(null);
    });

    afterEach(() => vi.useRealTimers());

    it("never waits for GitHub: a page gets the last answer at once and the check runs in the background", async () => {
        let answer: (value: unknown) => void = () => {};
        fetchMock.mockReturnValue(new Promise((resolve) => (answer = resolve)));
        const service = await freshService();

        await expect(service.getUpdateInfo()).resolves.toMatchObject({ updateAvailable: false, currentVersion: CURRENT_VERSION });
        // A second page while the check still runs starts no second one.
        await service.getUpdateInfo();
        expect(fetchMock).toHaveBeenCalledTimes(1);

        answer(tags(NEWER));
        await settle();
        await expect(service.getUpdateInfo()).resolves.toMatchObject({ updateAvailable: true, latestVersion: NEWER });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("asks GitHub again once the answer is an hour old", async () => {
        fetchMock.mockResolvedValue(tags(NEWER));
        const service = await freshService();
        await service.getUpdateInfo();
        await settle();

        vi.setSystemTime(Date.now() + 59 * MINUTE);
        await service.getUpdateInfo();
        expect(fetchMock).toHaveBeenCalledTimes(1);

        vi.setSystemTime(Date.now() + 2 * MINUTE);
        await service.getUpdateInfo();
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("tries a failed check again after ten minutes, not on every page of an instance without internet", async () => {
        fetchMock.mockRejectedValue(new Error("getaddrinfo ENOTFOUND api.github.com"));
        const service = await freshService();
        await service.getUpdateInfo();
        await settle();

        await expect(service.getUpdateInfo()).resolves.toMatchObject({ updateAvailable: false });
        expect(fetchMock).toHaveBeenCalledTimes(1);

        vi.setSystemTime(Date.now() + 11 * MINUTE);
        await service.getUpdateInfo();
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("asks nothing while Look for new versions is off", async () => {
        prisma.systemSetting.findUnique.mockResolvedValue({ key: "general.checkForUpdates", value: "false" });
        const service = await freshService();

        await expect(service.getUpdateInfo()).resolves.toMatchObject({ updateAvailable: false });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("keeps what the daily task found for the dashboard", async () => {
        fetchMock.mockResolvedValue(tags(NEWER));
        const service = await freshService();

        await service.checkForUpdates();

        await expect(service.getUpdateInfo()).resolves.toMatchObject({ updateAvailable: true, latestVersion: NEWER });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});
