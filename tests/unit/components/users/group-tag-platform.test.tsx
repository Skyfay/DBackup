/**
 * The group cell of an account that runs the platform: a platform admin or someone of a platform
 * group needs no group in the tenant, so the cell says Platform only instead of the amber No group.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { GroupTag } from "@/components/dashboard/users/user-cells";
import { onPlatform } from "@/components/dashboard/users/user-tenants";

describe("the group cell of an account of the platform", () => {
    it("counts an account with a platform group inside a tenant as one of the platform", () => {
        expect(onPlatform({ superAdmin: false, withPlatformGroup: true })).toBe(true);
        expect(onPlatform({ superAdmin: true })).toBe(true);
        expect(onPlatform({ superAdmin: false })).toBe(false);
    });

    it("says Platform only, never the amber No group", () => {
        render(<GroupTag group={null} platform />);

        expect(screen.getByText("Platform only")).toBeInTheDocument();
        expect(screen.queryByText("No group")).not.toBeInTheDocument();
    });

    it("keeps the amber No group for an account that sees nothing", () => {
        render(<GroupTag group={null} />);

        expect(screen.getByText("No group")).toHaveClass("text-warning");
    });
});
