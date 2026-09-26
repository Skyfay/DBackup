"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Settings } from "lucide-react";
import { restoreFromStorageAction } from "@/app/actions/backup/config-management";
import { SwitchList, SwitchRow } from "@/components/adapter/setting-switches";
import type { FileInfo } from "@/components/dashboard/storage/file-info";
import { ConfirmDialog, DialogItemList } from "@/components/ui/confirm-dialog";
import { useUserPreferences } from "@/hooks/use-user-preferences";
import type { RestoreOptions } from "@/lib/types/config-backup";
import { RestoreBar } from "./restore-frame";
import { Notice, Section } from "./restore-parts";

const PARTS: { key: keyof RestoreOptions; title: string; description: string }[] = [
    { key: "settings", title: "System settings", description: "Time zone, system tasks, notifications and the rest of Settings" },
    { key: "adapters", title: "Connections", description: "Databases, destinations, directory sources and notification channels" },
    { key: "jobs", title: "Jobs and schedules", description: "Every job with its destinations and notifications" },
    { key: "users", title: "Users and groups", description: "Users, groups and API keys" },
    { key: "sso", title: "SSO providers", description: "The OpenID Connect logins" },
    { key: "profiles", title: "Vault profiles", description: "Encryption keys and saved logins" },
    { key: "statistics", title: "Statistics and history", description: "Past runs and the storage history" },
];

/**
 * A config backup of DBackup itself comes back as a whole or in parts, picked with switches. It
 * replaces what is set up here, so it asks with a red confirmation first.
 */
export function SystemRestore({ file, destinationId, onCancel }: { file: FileInfo; destinationId: string; onCancel: () => void }) {
    const router = useRouter();
    const { autoRedirectOnJobStart } = useUserPreferences();
    const [options, setOptions] = useState<RestoreOptions>({ settings: true, adapters: true, jobs: true, users: true, sso: true, profiles: true, statistics: false });
    const [confirming, setConfirming] = useState(false);
    const [restoring, setRestoring] = useState(false);
    const picked = PARTS.filter((part) => options[part.key]);

    const start = async () => {
        setRestoring(true);
        try {
            const res = await restoreFromStorageAction(destinationId, file.path, undefined, options);
            if (res.success && res.executionId) {
                toast.success("The configuration is restored in the background");
                router.push(autoRedirectOnJobStart ? `/dashboard/history?executionId=${res.executionId}&autoOpen=true` : `/dashboard/storage?at=${encodeURIComponent(destinationId)}`);
                return;
            }
            toast.error(res.error || "The restore could not start");
            setConfirming(false);
        } catch {
            toast.error("The restore could not start");
            setConfirming(false);
        } finally {
            setRestoring(false);
        }
    };

    return (
        <div className="space-y-4 md:space-y-6">
            <Notice tone="destructive" title="This replaces the configuration of this DBackup">
                What you pick below is overwritten with the one in the backup, and what was set up here since is gone. It cannot be undone.
            </Notice>
            <Section title="What comes back" note="The parts of the configuration in this backup">
                <SwitchList>
                    {PARTS.map((part) => (
                        <SwitchRow key={part.key} title={part.title} description={part.description} checked={!!options[part.key]} onCheckedChange={(checked) => setOptions((current) => ({ ...current, [part.key]: checked }))} />
                    ))}
                </SwitchList>
            </Section>
            <RestoreBar
                title={`Restores ${picked.length} of ${PARTS.length} parts of the configuration`}
                detail={picked.length > 0 ? picked.map((part) => part.title).join(", ") : ""}
                blocker={picked.length === 0 ? "Pick a part of the configuration to restore" : null}
                onCancel={onCancel}
                action={{ label: "Restore the configuration", onClick: () => setConfirming(true), pending: restoring, tone: "destructive" }}
            />
            <ConfirmDialog
                open={confirming}
                onOpenChange={setConfirming}
                title="Restore the configuration of DBackup?"
                note="Cannot be undone"
                destructive
                icon={Settings}
                confirmLabel="Restore the configuration"
                isPending={restoring}
                onConfirm={() => void start()}
            >
                <DialogItemList items={picked.map((part) => ({ name: part.title, detail: "replaced", detailTone: "warning" as const, icon: Settings }))} />
            </ConfirmDialog>
        </div>
    );
}
