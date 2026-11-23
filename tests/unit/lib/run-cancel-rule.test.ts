import { describe, expect, it } from "vitest";
import { CANCEL_PERMISSIONS, cancellableRunTypes, mayCancelRun } from "@/lib/auth/run-cancel-rule";

const member = (permissions: readonly string[]) => ({ permissions, isPlatformAdmin: false, allTenants: false, authMethod: "session" as const });

describe("who may cancel a run", () => {
    it("asks the right that starts a run of its kind", () => {
        expect(mayCancelRun(member(["jobs:execute"]), "Backup")).toBe(true);
        expect(mayCancelRun(member(["jobs:execute"]), "Restore")).toBe(false);
        expect(mayCancelRun(member(["storage:restore"]), "Restore")).toBe(true);
        expect(mayCancelRun(member(["jobs:execute"]), "IntegrityCheck")).toBe(false);
        expect(mayCancelRun(member(["settings:write"]), "IntegrityCheck")).toBe(true);
        expect(mayCancelRun(member(["storage:read"]), "Verification")).toBe(true);
    });

    it("leaves the configuration restore and an unknown kind to a platform admin with a session", () => {
        expect(mayCancelRun(member(CANCEL_PERMISSIONS), "System Restore")).toBe(false);
        expect(mayCancelRun(member(CANCEL_PERMISSIONS), "Something new")).toBe(false);
        expect(mayCancelRun({ permissions: [], isPlatformAdmin: true, allTenants: false, authMethod: "session" }, "System Restore")).toBe(true);
        expect(mayCancelRun({ permissions: [], isPlatformAdmin: true, allTenants: false, authMethod: "apikey" }, "System Restore")).toBe(false);
    });

    it("cancels nothing in All tenants, which changes no tenant", () => {
        expect(cancellableRunTypes({ permissions: CANCEL_PERMISSIONS, isPlatformAdmin: true, allTenants: true })).toEqual([]);
    });

    it("lists the kinds a viewer may cancel for the History pages", () => {
        expect(cancellableRunTypes(member(["jobs:execute", "storage:read"]))).toEqual(["Backup", "Verification"]);
        expect(cancellableRunTypes({ permissions: [], isPlatformAdmin: true, allTenants: false })).toEqual(["Backup", "Restore", "IntegrityCheck", "Verification", "System Restore"]);
    });
});
