import { describe, expect, it } from "vitest";
import { Archive, CalendarClock, SquareTerminal } from "lucide-react";
import { describeSchedule } from "@/components/dashboard/jobs/job-schedule";
import { hitItems, iconOf, mayOpen, subLine, visibleChips } from "@/components/layout/search-items";
import { actionItems, pageItems, settingItems } from "@/components/layout/search-offers";
import { PERMISSIONS } from "@/lib/auth/permissions";
import type { SearchHit } from "@/services/search/search-types";

const everything = () => true;
const only = (...allowed: string[]) => (permission: string) => allowed.includes(permission);
const one = (hit: SearchHit) => hitItems(hit)[0];

const job: SearchHit = { kind: "job", id: "j1", name: "Nightly MySQL", enabled: true, schedule: "0 2 * * *", adapterId: "mysql", lastStatus: "Failed" };

describe("the rows of the global search", () => {
    it("opens a found job in the list of jobs, and its backups on the Backups page", () => {
        const row = one(job);
        const backups = one({ kind: "backups", jobId: "j1", name: "Nightly MySQL" });

        expect(row).toMatchObject({ group: "jobs", title: "Nightly MySQL", href: "/dashboard/jobs?job=j1", adapterId: "mysql", needs: [PERMISSIONS.JOBS.READ] });
        expect(subLine(row)).toBe(`${describeSchedule("0 2 * * *").text} · failed on its last run`);
        expect(backups).toMatchObject({ group: "backups", title: "Backups of Nightly MySQL", href: "/dashboard/backups?job=j1", needs: [PERMISSIONS.STORAGE.READ] });
        expect(iconOf(backups)).toBe(Archive);
    });

    it("says a job is paused before how its last run went", () => {
        expect(one({ ...job, enabled: false }).state).toBe("paused");
    });

    it("opens a connection on the tab of its kind, which needs the permission of that tab", () => {
        const connection = (id: string, type: string, storageRole: string | null): SearchHit => ({ kind: "connection", id, name: id, adapterId: "mysql", type, storageRole, status: "ONLINE" });

        expect(one(connection("a", "database", null))).toMatchObject({ href: "/dashboard/connections?tab=databases&open=a", needs: [PERMISSIONS.SOURCES.VIEW] });
        expect(one(connection("b", "storage", "SOURCE"))).toMatchObject({ href: "/dashboard/connections?tab=directory-sources&open=b", needs: [PERMISSIONS.DESTINATIONS.READ] });
        expect(one(connection("c", "storage", "DESTINATION"))).toMatchObject({ href: "/dashboard/connections?tab=destinations&open=c", needs: [PERMISSIONS.DESTINATIONS.READ] });
        expect(one(connection("d", "notification", null))).toMatchObject({ href: "/dashboard/connections?tab=notifications&open=d", needs: [PERMISSIONS.NOTIFICATIONS.READ] });
    });

    it("says a connection that does not answer, but never of a channel", () => {
        const server = one({ kind: "connection", id: "a", name: "db-prod", adapterId: "mysql", type: "database", storageRole: null, status: "OFFLINE" });
        const channel = one({ kind: "connection", id: "b", name: "Ops", adapterId: "discord", type: "notification", storageRole: null, status: "OFFLINE" });

        expect(subLine(server)).toMatch(/^Database connection · .+ · does not answer$/);
        expect(subLine(channel)).not.toMatch(/answer/);
    });

    it("opens a database in the Database Explorer and a run on its page", () => {
        const database = one({ kind: "database", serverId: "s1", serverName: "db-prod", adapterId: "mysql", name: "shop", sizeInBytes: null });
        const run = one({ kind: "run", id: "r1", name: "Nightly MySQL", status: "Partial", startedAt: new Date(Date.now() - 3_600_000).toISOString(), adapterId: "mysql" });

        expect(database).toMatchObject({ title: "shop", sub: "on db-prod", href: "/dashboard/explorer/database?server=s1&database=shop", needs: [PERMISSIONS.SOURCES.VIEW] });
        expect(run).toMatchObject({ title: "Run of Nightly MySQL", href: "/dashboard/history/run?id=r1&from=history", needs: [PERMISSIONS.HISTORY.READ] });
        expect(subLine(run)).toBe("Missed a copy · 1 hour ago");
        // A recent entry keeps when the run started, so the time ago is still right a day later.
        expect(subLine({ ...run, state: null, at: new Date(Date.now() - 86_400_000).toISOString() })).toBe("1 day ago");
    });

    it("opens people, groups and API keys on their tab of Users & Groups", () => {
        const user = one({ kind: "user", id: "u1", name: "Manu", email: "ops@example.com", group: null });
        const group = one({ kind: "group", id: "g1", name: "Operators", people: 1 });
        const key = one({ kind: "apiKey", id: "k1", name: "CI", prefix: "dbackup_a3f2b1c8", owner: "Manu", enabled: true, expired: true });

        expect(user).toMatchObject({ group: "access", sub: "ops@example.com · No group", href: "/dashboard/users?tab=users&open=u1", needs: [PERMISSIONS.USERS.READ] });
        expect(group).toMatchObject({ sub: "1 person", href: "/dashboard/users?tab=groups&open=g1", needs: [PERMISSIONS.GROUPS.READ] });
        expect(key).toMatchObject({ sub: "dbackup_a3f2b1c8… · Manu", state: "expired", href: "/dashboard/users?tab=apikeys&open=k1", needs: [PERMISSIONS.API_KEYS.READ] });
        expect(one({ kind: "apiKey", id: "k2", name: "Off", prefix: "p", owner: "Manu", enabled: false, expired: true }).state).toBe("off");
    });

    it("opens a template on the tab of its kind and says what it holds", () => {
        const schedule = one({ kind: "template", id: "t1", name: "Nightly", template: "schedules", detail: "0 2 * * *" });
        const naming = one({ kind: "template", id: "t2", name: "Dated", template: "naming", detail: "{name}_yyyy-MM-dd" });

        expect(schedule).toMatchObject({ group: "templates", sub: `Schedule preset · ${describeSchedule("0 2 * * *").text}`, href: "/dashboard/templates?tab=schedules&open=t1", needs: [PERMISSIONS.TEMPLATES.READ] });
        expect(iconOf(schedule)).toBe(CalendarClock);
        expect(naming.sub).toBe("File name · {name}_yyyy-MM-dd");
    });

    it("opens keys and saved logins in the Vault, the logins only with the credentials as well", () => {
        const key = one({ kind: "key", id: "e1", name: "Prod key", jobs: 2 });
        const login = one({ kind: "credential", id: "c1", name: "Prod login", type: "SSH_KEY" });

        expect(key).toMatchObject({ group: "vault", sub: "Encryption key of 2 jobs", href: "/dashboard/vault?tab=encryption&open=e1", needs: [PERMISSIONS.VAULT.READ] });
        expect(one({ kind: "key", id: "e2", name: "Spare", jobs: 0 }).sub).toBe("Encryption key no job uses");
        expect(login).toMatchObject({ sub: "SSH login", href: "/dashboard/vault?tab=credentials&open=c1", needs: [PERMISSIONS.VAULT.READ, PERMISSIONS.CREDENTIALS.READ] });
        expect(iconOf(login)).toBe(SquareTerminal);
        expect(mayOpen(login, only(PERMISSIONS.VAULT.READ))).toBe(false);
    });

    it("keeps a recent entry only while the viewer may still open it", () => {
        const recent = { ...one(job), group: "recent" as const };

        expect(mayOpen(recent, only(PERMISSIONS.JOBS.READ))).toBe(true);
        expect(mayOpen(recent, only(PERMISSIONS.HISTORY.READ))).toBe(false);
    });

    it("shows the chips of the kinds the viewer may see and Settings, which holds the own profile", () => {
        expect(visibleChips(only(PERMISSIONS.JOBS.READ)).map((chip) => chip.label)).toEqual(["All", "Jobs", "Settings"]);
        expect(visibleChips(only(PERMISSIONS.GROUPS.READ, PERMISSIONS.VAULT.READ)).map((chip) => chip.label)).toEqual(["All", "Users", "Vault", "Settings"]);
        expect(visibleChips(everything)).toHaveLength(10);
    });
});

describe("what the search offers without the server", () => {
    it("offers only the pages of the sidebar the viewer may open, and the profile to everyone", () => {
        const titles = pageItems("", only(PERMISSIONS.JOBS.READ)).map((item) => item.title);

        expect(titles).toContain("Jobs");
        expect(titles).toContain("Profile");
        expect(titles).not.toContain("Settings");
        expect(titles).not.toContain("Quick Setup");
        expect(pageItems("job", everything).map((item) => item.title)).toEqual(["Jobs"]);
        expect(iconOf(pageItems("job", everything)[0])).toBe(CalendarClock);
    });

    it("finds settings only for someone who may read them, the own profile always", () => {
        const withSettings = settingItems("password", true);
        const withoutSettings = settingItems("password", false);

        expect(withoutSettings.length).toBeGreaterThan(0);
        expect(withoutSettings.every((item) => item.href?.startsWith("/dashboard/profile?part="))).toBe(true);
        expect(withSettings.filter((item) => item.href?.startsWith("/dashboard/settings?part=")).every((item) => item.needs?.includes(PERMISSIONS.SETTINGS.READ))).toBe(true);
        expect(settingItems("", true)).toEqual([]);
    });

    it("offers to start a found job that is on, to someone who may start jobs", () => {
        const paused: SearchHit = { ...job, id: "j2", name: "Paused", enabled: false };

        expect(actionItems("nightly", [job, paused], everything).map((item) => item.title)).toEqual(["Run Nightly MySQL now"]);
        expect(actionItems("nightly", [job], only(PERMISSIONS.JOBS.READ))).toEqual([]);
        expect(actionItems("theme", [], everything).map((item) => item.action)).toEqual(["theme"]);
    });
});
