/**
 * Role restrictions on storage adapters.
 *
 * Most storage serves either end, so the role is the user's choice and nothing here fires.
 * The check exists for adapters that only work one way round, where accepting the wrong
 * role would produce a config that cannot work and a job that fails on its first run.
 */

import { describe, it, expect, vi } from "vitest";
import { STORAGE_ROLES } from "@/lib/core/storage-roles";
import { ValidationError } from "@/lib/logging/errors";

const definitions: Array<{ id: string; name: string; supportedRoles?: readonly string[] }> = [
    { id: "sftp", name: "SFTP" },
    { id: "read-only-thing", name: "Read Only Thing", supportedRoles: [STORAGE_ROLES.SOURCE] },
    { id: "write-only-thing", name: "Write Only Thing", supportedRoles: [STORAGE_ROLES.DESTINATION] },
    { id: "either-way", name: "Either Way", supportedRoles: [STORAGE_ROLES.SOURCE, STORAGE_ROLES.DESTINATION] },
];

vi.mock("@/lib/adapters/definitions", () => ({
    get ADAPTER_DEFINITIONS() { return definitions; },
}));

const { validateStorageRole } = await import("@/lib/adapters/role-validation");

describe("validateStorageRole", () => {
    it("allows both roles for an adapter that does not restrict them", () => {
        // The case that covers every adapter shipping today, so this is also the guard
        // against the check quietly rejecting something it should not.
        expect(() => validateStorageRole("sftp", STORAGE_ROLES.SOURCE)).not.toThrow();
        expect(() => validateStorageRole("sftp", STORAGE_ROLES.DESTINATION)).not.toThrow();
    });

    it("allows the role an adapter declares", () => {
        expect(() => validateStorageRole("read-only-thing", STORAGE_ROLES.SOURCE)).not.toThrow();
        expect(() => validateStorageRole("write-only-thing", STORAGE_ROLES.DESTINATION)).not.toThrow();
        expect(() => validateStorageRole("either-way", STORAGE_ROLES.SOURCE)).not.toThrow();
    });

    it("rejects a source-only adapter used as a destination", () => {
        expect(() => validateStorageRole("read-only-thing", STORAGE_ROLES.DESTINATION)).toThrow(ValidationError);
    });

    it("rejects a destination-only adapter used as a source", () => {
        expect(() => validateStorageRole("write-only-thing", STORAGE_ROLES.SOURCE)).toThrow(ValidationError);
    });

    it("says what the adapter is and what it does support", () => {
        // The message is the whole user-facing part of this rule, so it is worth pinning.
        expect(() => validateStorageRole("read-only-thing", STORAGE_ROLES.DESTINATION))
            .toThrow(/'Read Only Thing' cannot be used as a Destination/);
        expect(() => validateStorageRole("read-only-thing", STORAGE_ROLES.DESTINATION))
            .toThrow(/It supports: Directory source/);
    });

    it("leaves an unknown adapter id to whatever validates it next", () => {
        // Inventing a second error for it here would bury the real one.
        expect(() => validateStorageRole("not-a-real-adapter", STORAGE_ROLES.DESTINATION)).not.toThrow();
    });
});
