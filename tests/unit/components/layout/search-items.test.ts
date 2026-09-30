import { describe, expect, it } from "vitest";
import { describeSchedule } from "@/components/dashboard/jobs/job-schedule";
import { actionItems, hitItems, pageItems, settingItems, subLine } from "@/components/layout/search-items";
import { PERMISSIONS } from "@/lib/auth/permissions";
import type { SearchHit } from "@/services/search/search-types";

const everything = () => true;
const only = (...allowed: string[]) => (permission: string) => allowed.includes(permission);

const job: SearchHit = { kind: "job", id: "j 1", name: "Nightly MySQL", enabled: true, schedule: "0 2 * * *", adapterId: "mysql", lastStatus: "Failed" };

describe("the rows of the global search", () => {
    it("opens a found job in the list of jobs and offers its backups to someone who may see them", () => {
        const [row, backups] = hitItems(job, everything);

        expect(row).toMatchObject({ group: "jobs", title: "Nightly MySQL", href: "/dashboard/jobs?job=j%201", adapterId: "mysql" });
        expect(subLine(row)).toBe(`${describeSchedule("0 2 * * *").text} · failed on its last run`);
        expect(backups).toMatchObject({ group: "backups", title: "Backups of Nightly MySQL", href: "/dashboard/backups?job=j%201" });
        expect(hitItems(job, only(PERMISSIONS.JOBS.READ))).toHaveLength(1);
    });

    it("says a job is paused before how its last run went", () => {
        const [row] = hitItems({ ...job, enabled: false }, everything);

        expect(row.state).toBe("paused");
    });

    it("opens a connection on the tab of its kind", () => {
        const connection = (id: string, type: string, storageRole: string | null): SearchHit => ({ kind: "connection", id, name: id, adapterId: "mysql", type, storageRole, status: "ONLINE" });

        expect(hitItems(connection("a", "database", null), everything)[0].href).toBe("/dashboard/connections?tab=databases&open=a");
        expect(hitItems(connection("b", "storage", "SOURCE"), everything)[0].href).toBe("/dashboard/connections?tab=directory-sources&open=b");
        expect(hitItems(connection("c", "storage", "DESTINATION"), everything)[0].href).toBe("/dashboard/connections?tab=destinations&open=c");
        expect(hitItems(connection("d", "notification", null), everything)[0].href).toBe("/dashboard/connections?tab=notifications&open=d");
    });

    it("says a connection that does not answer, but never of a channel", () => {
        const [server] = hitItems({ kind: "connection", id: "a", name: "db-prod", adapterId: "mysql", type: "database", storageRole: null, status: "OFFLINE" }, everything);
        const [channel] = hitItems({ kind: "connection", id: "b", name: "Ops", adapterId: "discord", type: "notification", storageRole: null, status: "OFFLINE" }, everything);

        expect(subLine(server)).toMatch(/^Database connection · .+ · does not answer$/);
        expect(subLine(channel)).not.toMatch(/answer/);
    });

    it("opens a database in the Database Explorer and a run on its page", () => {
        const [database] = hitItems({ kind: "database", serverId: "s1", serverName: "db-prod", adapterId: "mysql", name: "shop", sizeInBytes: null }, everything);
        const [run] = hitItems({ kind: "run", id: "r1", name: "Nightly MySQL", status: "Partial", startedAt: new Date(Date.now() - 3_600_000).toISOString(), adapterId: "mysql" }, everything);

        expect(database).toMatchObject({ title: "shop", sub: "on db-prod", href: "/dashboard/explorer/database?server=s1&database=shop" });
        expect(run).toMatchObject({ title: "Run of Nightly MySQL", href: "/dashboard/history/run?id=r1&from=history" });
        expect(subLine(run)).toBe("Missed a copy · 1 hour ago");
        // A recent entry keeps when the run started, so the time ago is still right a day later.
        expect(subLine({ ...run, state: null, at: new Date(Date.now() - 86_400_000).toISOString() })).toBe("1 day ago");
    });

    it("offers only the pages of the sidebar the viewer may open, and the profile to everyone", () => {
        const titles = pageItems("", only(PERMISSIONS.JOBS.READ)).map((item) => item.title);

        expect(titles).toContain("Jobs");
        expect(titles).toContain("Profile");
        expect(titles).not.toContain("Settings");
        expect(titles).not.toContain("Quick Setup");
        expect(pageItems("job", everything).map((item) => item.title)).toEqual(["Jobs"]);
    });

    it("finds settings only for someone who may read them, the own profile always", () => {
        const withSettings = settingItems("password", true);
        const withoutSettings = settingItems("password", false);

        expect(withoutSettings.length).toBeGreaterThan(0);
        expect(withoutSettings.every((item) => item.href?.startsWith("/dashboard/profile?part="))).toBe(true);
        expect(withSettings.some((item) => item.href?.startsWith("/dashboard/settings?part="))).toBe(true);
        expect(settingItems("", true)).toEqual([]);
    });

    it("offers to start a found job that is on, to someone who may start jobs", () => {
        const paused: SearchHit = { ...job, id: "j2", name: "Paused", enabled: false };

        expect(actionItems("nightly", [job, paused], everything).map((item) => item.title)).toEqual(["Run Nightly MySQL now"]);
        expect(actionItems("nightly", [job], only(PERMISSIONS.JOBS.READ))).toEqual([]);
        expect(actionItems("theme", [], everything).map((item) => item.action)).toEqual(["theme"]);
    });
});
