/**
 * The buttons of the destination, the logins and the key of the configuration backup stay shut with
 * the reason for everyone but a platform admin, like the server refuses them.
 */
import { describe, expect, it, vi } from "vitest";
import { connectionBulkActions } from "@/components/adapter/connection-bulk-actions";
import { configBackupLock } from "@/components/adapter/connection-row-rules";
import type { AdapterConfig } from "@/components/adapter/types";
import { keyLock, loginLock, unlessLocked } from "@/components/dashboard/vault/config-backup-lock";
import { CONFIG_BACKUP_DESTINATION_LOCKED, CONFIG_BACKUP_KEY_LOCKED, CONFIG_BACKUP_LOGIN_LOCKED } from "@/lib/core/config-backup-locks";

const toast = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const destination = (id: string, configBackup?: boolean): AdapterConfig => ({
    id, name: id, adapterId: "local", type: "storage", config: "{}", metadata: "{}", createdAt: "2026-09-01T00:00:00.000Z", storageRole: "DESTINATION",
    ...(configBackup ? { configBackup } : {}),
});

const TRASH = { days: 30, canDeletePermanently: true, undo: () => undefined };

describe("the destination of the configuration backup on the Connections page", () => {
    it("is locked with the reason for a member and open for a platform admin", () => {
        expect(configBackupLock(destination("nas", true), false)).toBe(CONFIG_BACKUP_DESTINATION_LOCKED);
        expect(configBackupLock(destination("nas", true), true)).toBeNull();
        expect(configBackupLock(destination("s3"), false)).toBeNull();
    });

    it("stays out of a bulk delete and a bulk setting of a member, with the reason", () => {
        const actions = connectionBulkActions("destination", true, TRASH, false);
        const remove = actions.find((action) => action.id === "delete")!;
        const airGap = actions.find((action) => action.id === "mark-air-gapped")!;

        expect(remove.ineligible?.(destination("nas", true))).toBe(CONFIG_BACKUP_DESTINATION_LOCKED);
        expect(airGap.ineligible?.(destination("nas", true))).toBe(CONFIG_BACKUP_DESTINATION_LOCKED);
        expect(airGap.isAvailable?.([destination("nas", true)])).toBe(false);
        expect(remove.ineligible?.(destination("s3"))).toBeNull();
        expect(connectionBulkActions("destination", true, TRASH, true).find((action) => action.id === "delete")!.ineligible?.(destination("nas", true))).toBeNull();
    });
});

describe("the login and the key of the configuration backup in the Vault", () => {
    it("are locked with the reason for a member and open for a platform admin", () => {
        expect(loginLock({ configBackup: true }, false)).toBe(CONFIG_BACKUP_LOGIN_LOCKED);
        expect(loginLock({ configBackup: true }, true)).toBeNull();
        expect(keyLock({ configBackup: true }, false)).toBe(CONFIG_BACKUP_KEY_LOCKED);
        expect(keyLock({ configBackup: false }, false)).toBeNull();
    });

    it("say why instead of revealing", () => {
        const reveal = vi.fn();
        const action = unlessLocked((key: { configBackup: boolean }) => keyLock(key, false), reveal)!;

        action({ configBackup: true });
        action({ configBackup: false });

        expect(toast.error).toHaveBeenCalledWith(CONFIG_BACKUP_KEY_LOCKED);
        expect(reveal).toHaveBeenCalledOnce();
        expect(unlessLocked(() => null, undefined)).toBeUndefined();
    });
});
