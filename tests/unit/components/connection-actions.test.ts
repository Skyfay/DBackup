import { describe, it, expect, vi } from "vitest";
import { connectionActions } from "@/components/adapter/connection-actions";

const ids = (groups: ReturnType<typeof connectionActions>) => groups.map((group) => [group.label, group.actions.map((action) => action.id)]);

describe("connectionActions", () => {
    it("groups what a connection can do and leaves out what the user may not", () => {
        const groups = connectionActions({
            onExplore: vi.fn(),
            onEdit: vi.fn(),
            onClone: vi.fn(),
            onDelete: vi.fn(),
        });

        expect(ids(groups)).toEqual([
            ["Inspect", ["explore"]],
            ["Manage", ["edit", "clone"]],
            [undefined, ["delete"]],
        ]);
    });

    it("offers nothing at all to a user who may only look", () => {
        expect(connectionActions({})).toEqual([]);
    });

    it("names the counterpart action and blocks it while a clone is being created", () => {
        const groups = connectionActions({
            onClone: vi.fn(),
            counterpart: { label: "Create as Destination", onSelect: vi.fn() },
            busy: true,
        });

        const manage = groups[0].actions;
        expect(manage.map((action) => action.label)).toEqual(["Clone", "Create as Destination"]);
        expect(manage.every((action) => action.disabled)).toBe(true);
    });

    it("marks only deleting as destructive", () => {
        const groups = connectionActions({ onEdit: vi.fn(), onDelete: vi.fn() });

        expect(groups.flatMap((group) => group.actions).filter((action) => action.tone === "destructive").map((action) => action.id)).toEqual(["delete"]);
    });

    it("colors each action like the dialog it opens", () => {
        const groups = connectionActions({
            onExplore: vi.fn(),
            onHistory: vi.fn(),
            onEdit: vi.fn(),
            onClone: vi.fn(),
            counterpart: { label: "Create as Destination", onSelect: vi.fn() },
            onDelete: vi.fn(),
        });

        const tones = Object.fromEntries(groups.flatMap((group) => group.actions).map((action) => [action.id, action.tone]));
        expect(tones).toEqual({
            explore: "neutral",
            history: "neutral",
            edit: "edit",
            clone: "create",
            counterpart: "create",
            delete: "destructive",
        });
    });
});
