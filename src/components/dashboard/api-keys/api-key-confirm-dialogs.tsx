"use client";

import { useState } from "react";
import { RefreshCw, Trash } from "lucide-react";
import { toast } from "sonner";
import { deleteApiKey, rotateApiKey } from "@/app/actions/auth/api-key";
import { FactList } from "@/components/adapter/connection-details-sections";
import { Notice } from "@/components/dashboard/storage/restore/restore-parts";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DateDisplay } from "@/components/utils/date-display";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import type { ApiKeyRow } from "@/services/auth/api-keys-types";
import type { CreatedKey } from "./api-key-created-dialog";

const log = logger.child({ component: "api-key-confirm-dialogs" });

/** Used within this counts as in use right now. */
const IN_USE_MS = 60 * 60_000;

const inUse = (key: ApiKeyRow, now: number) => key.lastUsedAt !== null && now - Date.parse(key.lastUsedAt) <= IN_USE_MS;

/** When the key was last used and what it started then, who it acts as and when it was made. */
function facts(key: ApiKeyRow) {
    return [
        {
            label: "Last used",
            value: key.lastUsedAt ? (
                <>
                    <RelativeTime date={key.lastUsedAt} />
                    {key.lastRun?.job && `, started ${key.lastRun.job}`}
                </>
            ) : (
                "never"
            ),
        },
        { label: "Acts as", value: key.isMine ? `${key.owner.name} (you)` : key.owner.name },
        { label: "Made", value: <DateDisplay date={key.createdAt} format="P" /> },
    ];
}

interface RotateProps {
    apiKey: ApiKeyRow;
    now: number;
    onClose: () => void;
    /** Gets the new secret, to show it once. */
    onRotated: (created: CreatedKey) => void;
}

/** Asks before a key gets a new secret, amber since whatever uses it fails until it has the new one. */
export function ApiKeyRotateDialog({ apiKey, now, onClose, onRotated }: RotateProps) {
    const [pending, setPending] = useState(false);

    const confirm = async () => {
        setPending(true);
        try {
            const result = await rotateApiKey(apiKey.id);
            if (result.success && result.data) {
                onRotated({ name: apiKey.name, rawKey: result.data.rawKey, templateId: null, permissions: apiKey.effective, rotated: true });
                return;
            }
            toast.error(result.error || "The key could not be rotated.");
        } catch (error) {
            // Without the right to change API keys the actions throw instead of answering.
            log.warn("Rotating an API key failed", { apiKeyId: apiKey.id }, wrapError(error));
            toast.error("The key could not be rotated.");
        }
        setPending(false);
    };

    return (
        <ConfirmDialog
            open
            onOpenChange={(open) => !open && onClose()}
            title={`Rotate ${apiKey.name}?`}
            note="The old secret stops working at once"
            description={`${apiKey.name} gets a new secret. The old one stops working at once, so whatever uses it fails until it has the new one.`}
            icon={RefreshCw}
            tone="warning"
            confirmLabel="Rotate key"
            isPending={pending}
            onConfirm={confirm}
            className="sm:max-w-xl"
        >
            <FactList facts={facts(apiKey)} columns={1} />
            {inUse(apiKey, now) && (
                <Notice tone="warning">It is in use right now. Change the secret wherever it is used right after, or rotate when nothing runs.</Notice>
            )}
        </ConfirmDialog>
    );
}

interface DeleteProps {
    apiKey: ApiKeyRow;
    now: number;
    onClose: () => void;
    onDeleted: () => void;
}

/** Asks before a key is deleted. */
export function ApiKeyDeleteDialog({ apiKey, now, onClose, onDeleted }: DeleteProps) {
    const [pending, setPending] = useState(false);

    const confirm = async () => {
        setPending(true);
        try {
            const result = await deleteApiKey(apiKey.id);
            if (result.success) {
                toast.success(`${apiKey.name} deleted`);
                onDeleted();
                return;
            }
            toast.error(result.error || "The key could not be deleted.");
        } catch (error) {
            log.warn("Deleting an API key failed", { apiKeyId: apiKey.id }, wrapError(error));
            toast.error("The key could not be deleted.");
        }
        setPending(false);
    };

    return (
        <ConfirmDialog
            open
            onOpenChange={(open) => !open && onClose()}
            title={`Delete ${apiKey.name}?`}
            note="Cannot be undone"
            description="Whatever uses it is refused from its next request. The runs it started stay in History."
            icon={Trash}
            destructive
            confirmLabel="Delete key"
            isPending={pending}
            onConfirm={confirm}
            className="sm:max-w-xl"
        >
            <FactList facts={facts(apiKey)} columns={1} />
            {inUse(apiKey, now) && apiKey.state === "enabled" && (
                <Notice tone="warning">It is in use right now. Disable it first to see what stops, a disabled key can be enabled again.</Notice>
            )}
        </ConfirmDialog>
    );
}
