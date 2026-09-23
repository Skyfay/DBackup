import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LoginList } from "@/components/adapter/credential-picker-list";
import type { CredentialProfileSummary } from "@/components/settings/credential-profile-dialog";

const profile = (id: string, name: string, extra: Partial<CredentialProfileSummary> = {}): CredentialProfileSummary => ({
    id,
    name,
    type: "USERNAME_PASSWORD",
    description: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...extra,
});

const PROFILES = [
    profile("atlas", "MongoDB Atlas", { usageCount: 1, usedBy: ["mongodb"] }),
    profile("prod", "MySQL Prod", { description: "Backup user on db01", usageCount: 2, usedBy: ["mysql"] }),
    profile("spare", "Spare", { usageCount: 0, usedBy: [] }),
];

const MYSQL = { id: "mysql", name: "MySQL" };

function renderList(props: Partial<React.ComponentProps<typeof LoginList>> = {}) {
    const handlers = { onPick: vi.fn(), onEdit: vi.fn(), onCreate: vi.fn() };
    render(<LoginList profiles={PROFILES} value={null} requiredType="USERNAME_PASSWORD" adapter={MYSQL} noun="Login" required={false} {...handlers} {...props} />);
    return handlers;
}

describe("login list", () => {
    beforeAll(() => {
        // cmdk scrolls the highlighted row into view, which jsdom does not implement.
        Element.prototype.scrollIntoView = vi.fn();
    });

    it("suggests the logins other connections of the same kind use, and says where the rest are used", () => {
        renderList();

        const suggested = screen.getByRole("group", { name: "Used by your MySQL connections" });
        expect(within(suggested).getByRole("option", { name: /MySQL Prod/ })).toHaveTextContent("Backup user on db01 · Used by 2 connections");

        const others = screen.getByRole("group", { name: "Others" });
        expect(within(others).getByRole("option", { name: /MongoDB Atlas/ })).toHaveTextContent("Used by MongoDB");
        expect(within(others).getByRole("option", { name: /Spare/ })).toHaveTextContent("Not used yet");
    });

    it("picks a login on a click, while Edit opens it without picking it", async () => {
        const user = userEvent.setup();
        const { onPick, onEdit } = renderList();

        await user.click(screen.getByRole("button", { name: "Edit MySQL Prod" }));
        expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: "prod" }));
        expect(onPick).not.toHaveBeenCalled();

        await user.click(screen.getByRole("option", { name: /MongoDB Atlas/ }));
        expect(onPick).toHaveBeenCalledWith("atlas");
    });

    it("creates a new login from the foot of the list, named like the field", async () => {
        const user = userEvent.setup();
        const { onCreate } = renderList({ noun: "SSH login" });

        await user.click(screen.getByRole("button", { name: "New SSH login" }));
        expect(onCreate).toHaveBeenCalled();
    });

    it("offers to clear a login the connection can do without", async () => {
        const user = userEvent.setup();
        const { onPick } = renderList({ value: "prod" });

        await user.click(screen.getByRole("button", { name: "Use none" }));
        expect(onPick).toHaveBeenCalledWith(null);
    });

    it("offers no way to clear a login the connection needs", () => {
        renderList({ value: "prod", required: true });

        expect(screen.queryByRole("button", { name: "Use none" })).not.toBeInTheDocument();
        expect(screen.getByText("Required for MySQL")).toBeInTheDocument();
    });
});
