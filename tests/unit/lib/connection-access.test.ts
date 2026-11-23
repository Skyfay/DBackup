// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { seesConnectionType } from "@/lib/server/connection-access";

const caller = (permissions: string[]) => ({ isPlatformAdmin: false, allTenants: false, permissions });

describe("who learns that a connection exists", () => {
    it("is whoever may read or change connections of its type, so a key that only changes them still reaches them", () => {
        expect(seesConnectionType(caller([PERMISSIONS.SOURCES.VIEW]), "database")).toBe(true);
        expect(seesConnectionType(caller([PERMISSIONS.SOURCES.WRITE]), "database")).toBe(true);
        expect(seesConnectionType(caller([PERMISSIONS.DESTINATIONS.WRITE]), "storage")).toBe(true);
    });

    it("is nobody else, and nobody for a connection whose type was not found", () => {
        expect(seesConnectionType(caller([PERMISSIONS.DESTINATIONS.READ]), "database")).toBe(false);
        expect(seesConnectionType(caller([]), "notification")).toBe(false);
        expect(seesConnectionType(caller([PERMISSIONS.SOURCES.VIEW]), null)).toBe(false);
    });
});
