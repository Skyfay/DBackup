import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CredentialProfileDialog, type CredentialProfileSummary } from "@/components/settings/credential-profile-dialog";

vi.mock("sonner", () => ({
    toast: { success: vi.fn(), error: vi.fn() },
}));

const saved: CredentialProfileSummary = {
    id: "cred-1",
    name: "MySQL backup user",
    type: "USERNAME_PASSWORD",
    description: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
};

const mockFetch = vi.fn((_url: string, _init?: RequestInit) =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, data: saved }) } as Response)
);

const bodyOf = (call: number) => JSON.parse(String(mockFetch.mock.calls[call][1]?.body));

describe("credential profile dialog", () => {
    beforeEach(() => {
        mockFetch.mockClear();
        global.fetch = mockFetch as unknown as typeof fetch;
    });

    it("opens on the form for the kind a field asks for, named like the field", () => {
        render(<CredentialProfileDialog open onOpenChange={vi.fn()} forcedType="USERNAME_PASSWORD" noun="login" forName="MySQL" onSaved={vi.fn()} />);

        expect(screen.getByRole("heading", { name: "New login" })).toBeInTheDocument();
        expect(screen.getByText("User and password · for MySQL")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /Change type/ })).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Create login" })).toBeInTheDocument();
    });

    it("starts with the kinds from the Vault, each with the services that use it, and lets the kind be changed", async () => {
        const user = userEvent.setup();
        render(<CredentialProfileDialog open onOpenChange={vi.fn()} onSaved={vi.fn()} />);

        expect(screen.getByRole("heading", { name: "New credential profile" })).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: /SSH login.*SFTP/ }));
        expect(screen.getByRole("heading", { name: "New SSH login" })).toBeInTheDocument();
        expect(screen.getByRole("radio", { name: /Private key/ })).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: /Change type/ }));
        expect(screen.getByRole("heading", { name: "New credential profile" })).toBeInTheDocument();
    });

    it("creates a login from a field with the secret typed in", async () => {
        const user = userEvent.setup();
        const onSaved = vi.fn();
        render(<CredentialProfileDialog open onOpenChange={vi.fn()} forcedType="USERNAME_PASSWORD" noun="login" onSaved={onSaved} />);

        await user.type(screen.getByLabelText("Name"), "MySQL backup user");
        await user.type(screen.getByLabelText("Username"), "backup");
        await user.type(screen.getByLabelText("Password"), "s3cret");
        await user.click(screen.getByRole("button", { name: "Create login" }));

        expect(mockFetch.mock.calls[0][0]).toBe("/api/credentials");
        expect(bodyOf(0)).toEqual({
            name: "MySQL backup user",
            type: "USERNAME_PASSWORD",
            description: null,
            data: { username: "backup", password: "s3cret" },
        });
        expect(onSaved).toHaveBeenCalledWith(saved);
    });

    it("edits without showing the stored secret and keeps it when nothing new is typed", async () => {
        const user = userEvent.setup();
        render(<CredentialProfileDialog open onOpenChange={vi.fn()} editProfile={saved} onSaved={vi.fn()} />);

        expect(screen.getByRole("heading", { name: "Edit login" })).toBeInTheDocument();
        expect(screen.getByLabelText("Password")).toHaveValue("");
        await user.click(screen.getByRole("button", { name: "Save changes" }));

        expect(mockFetch.mock.calls[0][0]).toBe("/api/credentials/cred-1");
        expect(bodyOf(0)).toEqual({ name: "MySQL backup user", description: null });
    });
});
