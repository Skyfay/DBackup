import { describe, it, expect } from "vitest";
import { computeRestoreValidity, type RestoreValidationInput } from "@/app/dashboard/storage/restore/restore-validation";

const dir = (overrides: Partial<RestoreValidationInput["dirSelections"][number]> = {}) => ({
    selected: true,
    targetConfigId: "dest-1",
    targetPath: "/restore",
    selection: null,
    ...overrides,
});

function input(overrides: Partial<RestoreValidationInput> = {}): RestoreValidationInput {
    return {
        dbSelections: [],
        dirSelections: [],
        hasDirectories: false,
        analyzedDbCount: 0,
        isDirectoryOnly: false,
        targetSourceId: "",
        planError: null,
        ...overrides,
    };
}

describe("computeRestoreValidity", () => {
    it("allows restoring only directories from a DB+directory backup without a DB target", () => {
        // The exact case the old page blocked: databases analyzed but none selected.
        const v = computeRestoreValidity(input({
            dbSelections: [{ selected: false }, { selected: false }],
            dirSelections: [dir()],
            hasDirectories: true,
            analyzedDbCount: 2,
        }));

        expect(v.dbTargetNeeded).toBe(false);
        expect(v.canSubmit).toBe(true);
    });

    it("requires a target server as soon as one database is selected", () => {
        const base = input({
            dbSelections: [{ selected: true }],
            dirSelections: [dir()],
            hasDirectories: true,
            analyzedDbCount: 1,
        });

        expect(computeRestoreValidity(base).canSubmit).toBe(false);
        expect(computeRestoreValidity({ ...base, targetSourceId: "db-1" }).canSubmit).toBe(true);
    });

    it("keeps classic semantics for v1 archives and plain dumps", () => {
        // Nothing analyzed, no directories: the target server drives everything.
        const v = computeRestoreValidity(input({}));
        expect(v.classicMode).toBe(true);
        expect(v.canSubmit).toBe(false);
        expect(computeRestoreValidity(input({ targetSourceId: "db-1" })).canSubmit).toBe(true);
    });

    it("blocks a selected directory without a target adapter or path", () => {
        expect(computeRestoreValidity(input({
            hasDirectories: true,
            dirSelections: [dir({ targetConfigId: "" })],
        })).canSubmit).toBe(false);

        expect(computeRestoreValidity(input({
            hasDirectories: true,
            dirSelections: [dir({ targetPath: "   " })],
        })).canSubmit).toBe(false);
    });

    it("blocks a selected directory whose file selection is explicitly empty", () => {
        // selection [] means "nothing from this source" - deselect it instead.
        expect(computeRestoreValidity(input({
            hasDirectories: true,
            dirSelections: [dir({ selection: [] })],
        })).canSubmit).toBe(false);

        expect(computeRestoreValidity(input({
            hasDirectories: true,
            dirSelections: [dir({ selection: ["www"] })],
        })).canSubmit).toBe(true);
    });

    it("blocks submission when nothing at all is selected", () => {
        const v = computeRestoreValidity(input({
            dbSelections: [{ selected: false }],
            dirSelections: [dir({ selected: false })],
            hasDirectories: true,
            analyzedDbCount: 1,
        }));
        expect(v.atLeastOneSelected).toBe(false);
        expect(v.canSubmit).toBe(false);
    });

    it("ignores unselected directories' incomplete targets", () => {
        const v = computeRestoreValidity(input({
            hasDirectories: true,
            dirSelections: [dir(), dir({ selected: false, targetConfigId: "", targetPath: "" })],
        }));
        expect(v.canSubmit).toBe(true);
    });

    it("blocks submission while the dry run reports an error (e.g. broken chain)", () => {
        const v = computeRestoreValidity(input({
            hasDirectories: true,
            dirSelections: [dir()],
            planError: "This backup is part of an incremental chain and one archive it needs is missing: full-1.tar",
        }));
        expect(v.canSubmit).toBe(false);
    });

    it("works for directory-only archives without any database state", () => {
        const v = computeRestoreValidity(input({
            hasDirectories: true,
            isDirectoryOnly: true,
            dirSelections: [dir()],
        }));
        expect(v.dbTargetNeeded).toBe(false);
        expect(v.canSubmit).toBe(true);
    });
});
