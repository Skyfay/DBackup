/**
 * The API keys tab offers Rotate, Enable and the full editor only on a key the viewer holds, like
 * `holdsKey` on the server: their own, or any key for a platform admin. On a key of someone else
 * it offers only what takes access away: Edit for the name and a sooner end, Disable and Delete.
 */
import { describe, expect, it } from "vitest";
import { apiKeyActions, keyHandlers, keyLockReason, mayChangeKey } from "@/components/dashboard/api-keys/api-key-actions";
import type { ApiKeyRow } from "@/services/auth/api-keys-types";

const key = (over: Partial<ApiKeyRow>): ApiKeyRow => ({
    id: "key-1",
    name: "CI pipeline",
    prefix: "dbackup_12345678",
    permissions: ["jobs:execute", "history:read"],
    effective: ["jobs:execute", "history:read"],
    paused: [],
    ownerPermissions: ["jobs:read", "jobs:execute", "history:read"],
    owner: { id: "lena", name: "Lena", email: "lena@example.ch", image: null, groupName: "Operators" },
    state: "enabled",
    expiresAt: null,
    lastUsedAt: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    lastRun: null,
    isMine: false,
    tenantId: "default",
    platform: false,
    ...over,
});

const noop = () => {};
const ALL_HANDLERS = { onEdit: noop, onRotate: noop, onToggle: noop, onDelete: noop };
const ids = (row: ApiKeyRow, platformAdmin: boolean) => apiKeyActions(row, keyHandlers(row, ALL_HANDLERS, platformAdmin)).flatMap((group) => group.actions.map((action) => action.id));

describe("the keys the viewer may change", () => {
    it("lets only the owner and a platform admin change what a key may do, whatever the viewer's group may", () => {
        expect(mayChangeKey(key({}), false)).toBe(false);
        expect(mayChangeKey(key({ isMine: true }), false)).toBe(true);
        expect(mayChangeKey(key({}), true)).toBe(true);
    });

    it("offers on a key of someone else only Edit, Disable and Delete, and no Enable once it is disabled", () => {
        expect(ids(key({}), false)).toEqual(["edit", "toggle", "delete"]);
        expect(ids(key({ state: "disabled" }), false)).toEqual(["edit", "delete"]);
        expect(keyLockReason(key({ state: "disabled" }), false)).toMatch(/owner or a platform admin/);
    });

    it("offers every action on the own key and to a platform admin", () => {
        expect(ids(key({ isMine: true }), false)).toEqual(["edit", "rotate", "toggle", "delete"]);
        expect(ids(key({ state: "disabled" }), true)).toEqual(["edit", "rotate", "toggle", "delete"]);
        expect(keyLockReason(key({}), true)).toBeNull();
    });

    it("offers no action at all without the handlers", () => {
        expect(apiKeyActions(key({}), {})).toEqual([]);
    });
});
