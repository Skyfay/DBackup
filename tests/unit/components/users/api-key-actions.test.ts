/**
 * The API keys tab offers Edit, Rotate, Enable or Disable and Delete only on a key the viewer may
 * change, like `keyRefusal` on the server: their own, or one whose permissions that still work they
 * may all use themselves.
 */
import { describe, expect, it } from "vitest";
import { apiKeyActions, keyLockReason, mayChangeKey } from "@/components/dashboard/api-keys/api-key-actions";
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

describe("the keys the viewer may change", () => {
    it("refuses a key of someone else that may do more than the viewer", () => {
        expect(mayChangeKey(key({}), ["jobs:read", "jobs:execute"])).toBe(false);
        expect(keyLockReason(key({}), ["jobs:read"])).not.toBeNull();
    });

    it("allows the own key, and one the viewer may do all of", () => {
        expect(mayChangeKey(key({ isMine: true }), [])).toBe(true);
        expect(mayChangeKey(key({}), ["jobs:execute", "history:read", "jobs:read"])).toBe(true);
        // What the key holds but its owner lost does not count.
        expect(mayChangeKey(key({ permissions: ["jobs:execute", "storage:delete"], effective: ["jobs:execute"] }), ["jobs:execute"])).toBe(true);
    });

    it("offers no action at all once the tab leaves out the handlers of such a key", () => {
        expect(apiKeyActions(key({}), {})).toEqual([]);
        expect(apiKeyActions(key({}), ALL_HANDLERS).flatMap((group) => group.actions.map((action) => action.id))).toEqual(["edit", "rotate", "toggle", "delete"]);
    });
});
