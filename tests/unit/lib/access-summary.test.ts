import { describe, expect, it } from "vitest";
import { accessLine, accessSentences, listWords, summarizeAccess } from "@/lib/auth/access-summary";
import { AVAILABLE_PERMISSIONS, PERMISSIONS } from "@/lib/auth/permissions";

const OPERATORS = [
    PERMISSIONS.SOURCES.VIEW,
    PERMISSIONS.DESTINATIONS.READ,
    PERMISSIONS.JOBS.READ,
    PERMISSIONS.JOBS.EXECUTE,
    PERMISSIONS.STORAGE.READ,
    PERMISSIONS.STORAGE.DOWNLOAD,
    PERMISSIONS.STORAGE.RESTORE,
    PERMISSIONS.HISTORY.READ,
    PERMISSIONS.TEMPLATES.READ,
    PERMISSIONS.PROFILE.UPDATE_PASSWORD,
];

const EVERY_READ = [
    PERMISSIONS.SOURCES.VIEW,
    PERMISSIONS.JOBS.READ,
    PERMISSIONS.STORAGE.READ,
    PERMISSIONS.HISTORY.READ,
    PERMISSIONS.TEMPLATES.READ,
    PERMISSIONS.VAULT.READ,
    PERMISSIONS.USERS.READ,
    PERMISSIONS.GROUPS.READ,
    PERMISSIONS.API_KEYS.READ,
    PERMISSIONS.AUDIT.READ,
    PERMISSIONS.SETTINGS.READ,
];

describe("saying in words what a group lets its members do", () => {
    it("tells a group that runs jobs and restores what it sees, does and changes", () => {
        const summary = summarizeAccess(OPERATORS);

        expect(accessSentences(summary)).toEqual([
            "Sees the connections, the jobs, the backups, the history and the templates.",
            "Runs jobs, downloads and restores backups.",
            "Changes nothing.",
        ]);
        expect(accessLine(summary)).toBe("Runs jobs, downloads and restores backups, changes nothing");
        expect(summary.count).toBe(OPERATORS.length);
        expect(summary.total).toBe(AVAILABLE_PERMISSIONS.length);
    });

    it("sums up a group that reads everything and changes nothing", () => {
        const summary = summarizeAccess(EVERY_READ);

        expect(accessSentences(summary)).toEqual(["Sees everything.", "Changes nothing."]);
        expect(accessLine(summary)).toBe("Sees everything, changes nothing");
    });

    it("names the areas a group cannot see when there are only a few", () => {
        const summary = summarizeAccess(EVERY_READ.filter((permission) => permission !== PERMISSIONS.VAULT.READ && permission !== PERMISSIONS.USERS.READ));

        expect(accessLine(summary)).toBe("Sees all but the Vault and the users, changes nothing");
    });

    it("lists what a group changes", () => {
        const summary = summarizeAccess([PERMISSIONS.JOBS.READ, PERMISSIONS.JOBS.WRITE, PERMISSIONS.STORAGE.DELETE, PERMISSIONS.CREDENTIALS.WRITE]);

        expect(accessSentences(summary)).toEqual(["Sees the jobs.", "Deletes backups.", "Changes jobs and the Vault."]);
    });

    it("gives the SuperAdmin group everything", () => {
        const summary = summarizeAccess([], true);

        expect(summary.all).toBe(true);
        expect(summary.count).toBe(AVAILABLE_PERMISSIONS.length);
        expect(accessLine(summary)).toBe("Everything, always");
    });

    it("says nothing for a group without permissions or with only the own profile", () => {
        expect(accessSentences(summarizeAccess([]))).toEqual(["Nothing. Signs in, but sees and does nothing."]);
        expect(accessLine(summarizeAccess([PERMISSIONS.PROFILE.UPDATE_NAME]))).toBe("Nothing beyond the own profile");
    });

    it("joins words like a sentence", () => {
        expect(listWords([])).toBe("");
        expect(listWords(["a"])).toBe("a");
        expect(listWords(["a", "b"])).toBe("a and b");
        expect(listWords(["a", "b", "c"])).toBe("a, b and c");
    });
});
