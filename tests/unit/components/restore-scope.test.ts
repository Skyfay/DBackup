import { describe, it, expect } from "vitest";
import { needsRestoreScopeChoice, parseRestoreScope, normalizeRestoreScope } from "@/components/dashboard/storage/restore-scope";

describe("needsRestoreScopeChoice", () => {
    it("asks only when the backup holds databases and directories", () => {
        expect(needsRestoreScopeChoice({ databases: 2, directorySources: 1 })).toBe(true);
    });

    it("does not ask for a database-only backup", () => {
        expect(needsRestoreScopeChoice({ databases: 3, directorySources: 0 })).toBe(false);
    });

    it("does not ask for a files-only backup", () => {
        expect(needsRestoreScopeChoice({ databases: 0, directorySources: 2 })).toBe(false);
    });

    it("does not ask when the backup is not a combined archive", () => {
        expect(needsRestoreScopeChoice(undefined)).toBe(false);
        expect(needsRestoreScopeChoice(null)).toBe(false);
    });
});

describe("parseRestoreScope", () => {
    it("restores everything when no mode is given", () => {
        expect(parseRestoreScope(null)).toEqual({ wantsDatabases: true, wantsFiles: true });
        expect(parseRestoreScope(undefined)).toEqual({ wantsDatabases: true, wantsFiles: true });
    });

    it("restores everything for an explicit all", () => {
        expect(parseRestoreScope("all")).toEqual({ wantsDatabases: true, wantsFiles: true });
    });

    it("narrows to databases", () => {
        expect(parseRestoreScope("databases")).toEqual({ wantsDatabases: true, wantsFiles: false });
    });

    it("narrows to files", () => {
        expect(parseRestoreScope("files")).toEqual({ wantsDatabases: false, wantsFiles: true });
    });

    it("falls back to everything for an unknown value, so a hand-edited link still works", () => {
        expect(parseRestoreScope("nonsense")).toEqual({ wantsDatabases: true, wantsFiles: true });
    });
});

describe("normalizeRestoreScope", () => {
    it("passes the two narrowing scopes through", () => {
        expect(normalizeRestoreScope("databases")).toBe("databases");
        expect(normalizeRestoreScope("files")).toBe("files");
    });

    it("resolves everything else to all, which is what the backend defaults to", () => {
        expect(normalizeRestoreScope(null)).toBe("all");
        expect(normalizeRestoreScope(undefined)).toBe("all");
        expect(normalizeRestoreScope("all")).toBe("all");
        expect(normalizeRestoreScope("nonsense")).toBe("all");
    });
});
