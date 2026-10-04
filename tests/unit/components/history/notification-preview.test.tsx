import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NotificationPreview } from "@/components/dashboard/history/notification-preview";
import type { NotificationLogRow } from "@/components/dashboard/history/notification-types";

vi.mock("@/lib/auth/client", () => ({ useSession: () => ({ data: { user: { timeFormat: "HH:mm" } } }) }));

const entry = (overrides: Partial<NotificationLogRow> = {}): NotificationLogRow => ({
    id: "n1",
    eventType: "backup_failure",
    channelName: "Ops",
    adapterId: "discord",
    status: "Failed",
    title: "Backup failed",
    message: "Shop nightly failed at the dump.",
    fields: JSON.stringify([{ name: "Job", value: "Shop nightly" }]),
    renderedPayload: JSON.stringify({ embeds: [{ title: "Backup failed" }] }),
    sentAt: "2026-10-01T03:00:00.000Z",
    ...overrides,
});

describe("what a notification said", () => {
    it("names its views in sentence case, the channel first", () => {
        render(<NotificationPreview entry={entry()} />);

        expect(screen.getByRole("tab", { name: "Discord" })).toBeInTheDocument();
        expect(screen.getByRole("tab", { name: "Plain text" })).toBeInTheDocument();
        expect(screen.getByRole("tab", { name: "Raw payload" })).toBeInTheDocument();
    });

    it("shows a payload that is no JSON as it is, instead of breaking the panel", async () => {
        const user = userEvent.setup();
        render(<NotificationPreview entry={entry({ renderedPayload: "{not json" })} />);

        await user.click(screen.getByRole("tab", { name: "Raw payload" }));

        expect(screen.getByText("{not json")).toBeInTheDocument();
    });

    it("indents a JSON payload", async () => {
        const user = userEvent.setup();
        render(<NotificationPreview entry={entry()} />);

        await user.click(screen.getByRole("tab", { name: "Raw payload" }));

        expect(screen.getByText(/"title": "Backup failed"/)).toBeInTheDocument();
    });
});
