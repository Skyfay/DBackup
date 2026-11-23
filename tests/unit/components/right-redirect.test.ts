// @vitest-environment node
/**
 * Someone without the right of a page, like History without `history:read`, opens it from a
 * bookmark or a link. They land on the Overview like on the pages that check for themselves,
 * instead of the error page a `PermissionError` of `checkPermission` shows.
 */
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    viewer: null as null | { id: string; isPlatformAdmin: boolean; allTenants: boolean; permissions: string[] },
    redirect: vi.fn((to: string) => {
        throw new Error(`redirect ${to}`);
    }),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth/access-control", () => ({
    getViewer: async () => mocks.viewer,
    hasPermissionWithContext: (ctx: { permissions: string[] }, permission: string) => ctx.permissions.includes(permission),
}));

import { redirectWithoutRight } from "@/app/dashboard/right-redirect";

const viewer = (...permissions: string[]) => ({ id: "u1", isPlatformAdmin: false, allTenants: false, permissions });

describe("redirectWithoutRight", () => {
    beforeEach(() => {
        mocks.redirect.mockClear();
    });

    it("sends someone without the right to the Overview", async () => {
        mocks.viewer = viewer("jobs:read");
        await expect(redirectWithoutRight("history:read")).rejects.toThrow("redirect /dashboard");
    });

    it("sends a request without a session to the login page", async () => {
        mocks.viewer = null;
        await expect(redirectWithoutRight("history:read")).rejects.toThrow("redirect /");
        expect(mocks.redirect).toHaveBeenCalledWith("/");
    });

    it("hands the viewer to a page they may open", async () => {
        mocks.viewer = viewer("history:read");
        await expect(redirectWithoutRight("history:read")).resolves.toBe(mocks.viewer);
        expect(mocks.redirect).not.toHaveBeenCalled();
    });
});

describe("the pages of the dashboard", () => {
    const DASHBOARD = path.resolve(__dirname, "../../../src/app/dashboard");
    const pages = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        return entry.isDirectory() ? pages(full) : entry.name === "page.tsx" ? [full] : [];
    });

    it("never refuse with checkPermission, which shows the error page instead of a redirect", () => {
        const refusing = pages(DASHBOARD).filter((file) => /\bcheckPermission\(/.test(fs.readFileSync(file, "utf8"))).map((file) => path.relative(DASHBOARD, file));
        expect(refusing, "Use redirectWithoutRight from app/dashboard/right-redirect.ts").toEqual([]);
    });

    it.each(["history/page.tsx", "history/run/page.tsx", "explorer/page.tsx", "explorer/database/page.tsx", "explorer/server/page.tsx"])("%s redirects without its right", (page) => {
        expect(fs.readFileSync(path.join(DASHBOARD, page), "utf8")).toMatch(/redirectWithoutRight\(PERMISSIONS\.(HISTORY\.READ|SOURCES\.VIEW)\)/);
    });
});
