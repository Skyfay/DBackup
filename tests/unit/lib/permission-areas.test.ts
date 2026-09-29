import { describe, expect, it } from "vitest";
import { GROUP_TEMPLATES, freeGroupName } from "@/lib/auth/group-templates";
import {
    PERMISSION_AREAS,
    areaChanges,
    describeChange,
    knownPermissions,
    levelOf,
    levelsOf,
    rankOf,
    withLevel,
    withPermission,
} from "@/lib/auth/permission-areas";
import { AVAILABLE_PERMISSIONS, PERMISSIONS } from "@/lib/auth/permissions";

const area = (id: string) => PERMISSION_AREAS.find((entry) => entry.id === id)!;
const set = (...ids: string[]) => new Set<string>(ids);

describe("the permissions as areas with levels", () => {
    it("puts every permission into exactly one area, with a sentence", () => {
        const placed = PERMISSION_AREAS.flatMap((entry) => entry.permissions.map((permission) => permission.id));

        expect(placed.sort()).toEqual(AVAILABLE_PERMISSIONS.map((permission) => permission.id).sort());
        expect(new Set(placed).size).toBe(placed.length);
        for (const permission of PERMISSION_AREAS.flatMap((entry) => entry.permissions)) expect(permission.description.length).toBeGreaterThan(10);
    });

    it("builds each level on the one below, from permissions of its own area", () => {
        for (const entry of PERMISSION_AREAS) {
            const own = new Set<string>(entry.permissions.map((permission) => permission.id));
            let below: string[] = [];
            for (const level of levelsOf(entry).filter((value) => value !== "none")) {
                const held: string[] = entry.levels[level] ?? [];
                expect(held.every((id) => own.has(id))).toBe(true);
                expect(below.every((id) => held.includes(id))).toBe(true);
                below = held;
            }
            for (const permission of entry.permissions) expect((permission.needs ?? []).every((id) => own.has(id))).toBe(true);
        }
    });

    it("reads the level a group has in an area, or Custom", () => {
        const backups = area("backups");

        expect(levelOf(backups, set())).toBe("none");
        expect(levelOf(backups, set(PERMISSIONS.STORAGE.READ))).toBe("see");
        expect(levelOf(backups, set(PERMISSIONS.STORAGE.READ, PERMISSIONS.STORAGE.DOWNLOAD, PERMISSIONS.STORAGE.RESTORE))).toBe("use");
        expect(levelOf(backups, set(PERMISSIONS.STORAGE.READ, PERMISSIONS.STORAGE.DOWNLOAD))).toBe("custom");
        expect(rankOf(backups, set(PERMISSIONS.STORAGE.READ, PERMISSIONS.STORAGE.DOWNLOAD))).toBe(1);
    });

    it("keeps the dashboard numbers beside the level of the history until the history is set to None", () => {
        const history = area("history");
        const held = set(PERMISSIONS.HISTORY.READ, PERMISSIONS.DASHBOARD.READ);

        expect(levelOf(history, held)).toBe("see");
        expect(levelOf(history, set(PERMISSIONS.DASHBOARD.READ))).toBe("custom");
        expect([...withLevel(history, held, "see")].sort()).toEqual([PERMISSIONS.DASHBOARD.READ, PERMISSIONS.HISTORY.READ].sort());
        expect([...withLevel(history, held, "none")]).toEqual([]);
    });

    it("sets an area to a level without touching the other areas", () => {
        const held = withLevel(area("backups"), set(PERMISSIONS.JOBS.READ, PERMISSIONS.STORAGE.READ), "full");

        expect([...held].sort()).toEqual([PERMISSIONS.JOBS.READ, PERMISSIONS.STORAGE.READ, PERMISSIONS.STORAGE.DOWNLOAD, PERMISSIONS.STORAGE.RESTORE, PERMISSIONS.STORAGE.DELETE].sort());
    });

    it("ticks what a permission needs with it, and unticks what needs it", () => {
        const restore = withPermission(set(), PERMISSIONS.STORAGE.RESTORE, true);
        expect([...restore].sort()).toEqual([PERMISSIONS.STORAGE.READ, PERMISSIONS.STORAGE.RESTORE].sort());

        const withoutRead = withPermission(set(PERMISSIONS.STORAGE.READ, PERMISSIONS.STORAGE.RESTORE, PERMISSIONS.JOBS.READ), PERMISSIONS.STORAGE.READ, false);
        expect([...withoutRead]).toEqual([PERMISSIONS.JOBS.READ]);
    });

    it("says which areas changed and how", () => {
        const before = set(PERMISSIONS.STORAGE.READ, PERMISSIONS.TEMPLATES.READ);
        const after = set(PERMISSIONS.STORAGE.READ, PERMISSIONS.STORAGE.DOWNLOAD, PERMISSIONS.STORAGE.RESTORE, PERMISSIONS.TEMPLATES.READ);
        const changes = areaChanges(before, after);

        expect(changes.map((change) => describeChange(change, before, after))).toEqual(["Backups See to Use"]);
    });

    it("keeps only the permissions DBackup knows", () => {
        expect(knownPermissions(["jobs:read", "made:up", "jobs:read"])).toEqual([PERMISSIONS.JOBS.READ]);
    });
});

describe("the templates of a new group", () => {
    it("hold only permissions DBackup knows and give every member their own profile", () => {
        for (const template of GROUP_TEMPLATES) {
            expect(knownPermissions(template.permissions)).toEqual(template.permissions);
            expect(template.permissions).toContain(PERMISSIONS.PROFILE.UPDATE_PASSWORD);
        }
    });

    it("never let a viewer reveal a secret or change anything", () => {
        const viewer = GROUP_TEMPLATES.find((template) => template.id === "viewer")!;

        expect(viewer.permissions).not.toContain(PERMISSIONS.CREDENTIALS.REVEAL);
        expect(viewer.permissions.filter((id) => id.endsWith(":write"))).toEqual([]);
    });

    it("finds a name nobody has", () => {
        expect(freeGroupName("Operators", ["Viewers"])).toBe("Operators");
        expect(freeGroupName("Operators", ["operators", "Operators 2"])).toBe("Operators 3");
    });
});
