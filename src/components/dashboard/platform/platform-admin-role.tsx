"use client";

import { useState, type ReactNode } from "react";
import { ShieldMinus, ShieldPlus } from "lucide-react";
import { toast } from "sonner";
import { setPlatformAdmin } from "@/app/actions/tenant/members";
import type { BackupAction } from "@/components/dashboard/storage/explorer/backup-actions";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";

/**
 * The platform admin role of an account, in one place for every page that gives or takes it: the
 * entry of a menu, the confirmation and the request. The pages show the role as the built-in
 * platform group Platform admin. The pick of the platform group in the panel of an account asks
 * with the same confirmation, and the menu entry stays a shortcut to it for a platform admin.
 */

const log = logger.child({ component: "platform-admin-role" });

/** "Make platform admin", or "No platform admin any more" for an account that is one, in the amber of a warning. */
export function platformAdminAction(isPlatformAdmin: boolean, onSelect: () => void): BackupAction {
    return isPlatformAdmin
        ? { id: "admin-off", label: "No platform admin any more", icon: ShieldMinus, onSelect, tone: "warning" }
        : { id: "admin-on", label: "Make platform admin", icon: ShieldPlus, onSelect, tone: "warning" };
}

interface PlatformAdminConfirmDialogProps {
    /** The name of the account. */
    name: string;
    /** Makes the account a platform admin, or takes the role back. */
    on: boolean;
    /** The tenant the change is made from, which the account keeps, named in the words. */
    tenantName?: string;
    pending: boolean;
    onClose: () => void;
    onConfirm: () => void;
}

/** Asks before an account becomes a platform admin or stops being one, in the tone of a warning. */
export function PlatformAdminConfirmDialog({ name, on, tenantName, pending, onClose, onConfirm }: PlatformAdminConfirmDialogProps) {
    const common = { open: true, onOpenChange: (open: boolean) => !open && onClose(), isPending: pending, onConfirm, tone: "warning" as const };
    return on ? (
        <ConfirmDialog
            {...common}
            icon={ShieldPlus}
            title={`Make ${name} a platform admin?`}
            note="Opens every tenant"
            description="A platform admin sees and changes every tenant, creates and deletes them, and decides the sign-in providers, the configuration restore and the download of the database."
            confirmLabel="Make platform admin"
        />
    ) : (
        <ConfirmDialog
            {...common}
            icon={ShieldMinus}
            title={`Take the platform admin role from ${name}?`}
            note="Keeps the tenants they are a member of"
            description={tenantName
                ? `${name} keeps ${tenantName} and every other tenant they are a member of, each with its group, and no longer opens the rest.`
                : `${name} keeps every tenant they are a member of, each with its group, and no longer opens the rest or the Platform.`}
            confirmLabel="Take it back"
        />
    );
}

/** A change of the role someone asked for. */
export interface PlatformAdminChange {
    userId: string;
    name: string;
    on: boolean;
}

/**
 * Gives or takes the platform admin role after a confirmation: `ask` opens it, `dialog` is the
 * confirmation to render. The server refuses the own account and the last platform admin with a
 * reason, which shows as a toast.
 */
export function usePlatformAdminRole(onChanged: () => void): { ask: (change: PlatformAdminChange) => void; dialog: ReactNode } {
    const [asked, setAsked] = useState<PlatformAdminChange | null>(null);
    const [pending, setPending] = useState(false);

    const confirm = async (change: PlatformAdminChange) => {
        setPending(true);
        try {
            const result = await setPlatformAdmin(change.userId, change.on);
            if (!result.success) {
                toast.error(result.error);
                return;
            }
            toast.success(change.on ? `${change.name} is a platform admin now` : `${change.name} is no platform admin any more`);
            setAsked(null);
            onChanged();
        } catch (error: unknown) {
            // Anyone but a platform admin is refused with a throw.
            log.warn("Changing a platform admin failed", { userId: change.userId }, wrapError(error));
            toast.error("The role could not be changed.");
        } finally {
            setPending(false);
        }
    };

    const dialog = asked ? (
        <PlatformAdminConfirmDialog
            name={asked.name}
            on={asked.on}
            pending={pending}
            onClose={() => !pending && setAsked(null)}
            onConfirm={() => void confirm(asked)}
        />
    ) : null;

    return { ask: setAsked, dialog };
}
