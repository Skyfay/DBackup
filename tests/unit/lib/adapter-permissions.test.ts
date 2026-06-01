import { describe, expect, it } from "vitest";
import { ADAPTER_DEFINITIONS } from "@/lib/adapters/definitions";
import { getPermissionForAdapter } from "@/lib/auth/adapter-permissions";

describe("adapter permissions", () => {
    it("maps every registered adapter definition to an RBAC permission", () => {
        const unmapped = ADAPTER_DEFINITIONS
            .map(({ id }) => id)
            .filter((id) => getPermissionForAdapter(id) === null);

        expect(unmapped).toEqual([]);
    });

    it("fails closed for unknown adapters", () => {
        expect(getPermissionForAdapter("future-adapter")).toBeNull();
    });
});
