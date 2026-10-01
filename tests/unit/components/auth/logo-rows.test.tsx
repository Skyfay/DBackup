import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { LogoRows } from "@/components/auth/logo-rows";

const adapters = { databases: ["postgres", "mysql"], storage: ["s3-aws"], notifications: ["discord", "slack"] };

describe("the logos of the login page", () => {
    it("runs every adapter in a row of its kind, twice so the loop has no seam", () => {
        const { container } = render(<LogoRows adapters={adapters} />);

        const rows = container.querySelectorAll(".w-max");
        expect(rows).toHaveLength(3);
        expect(rows[0].children).toHaveLength(4);
        expect(rows[1].children).toHaveLength(2);
        expect(rows[2].children).toHaveLength(4);
    });

    it("moves only without Reduce motion, the middle row the other way, and hides from screen readers", () => {
        const { container } = render(<LogoRows adapters={adapters} />);

        const rows = [...container.querySelectorAll(".w-max")].map((row) => row.className);
        expect(rows.every((className) => className.includes("motion-safe:animate-[login-drift"))).toBe(true);
        expect(rows[1]).toContain("reverse");
        expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
    });

    it("puts databases and storage in one row on a phone", () => {
        const { container } = render(<LogoRows adapters={adapters} single />);

        const rows = container.querySelectorAll(".w-max");
        expect(rows).toHaveLength(1);
        expect(rows[0].children).toHaveLength(6);
    });
});
