"use client";

import { useCallback, useState } from "react";
import { useFormContext } from "react-hook-form";
import { FolderPickerDialog, type FolderLevel } from "@/components/dashboard/storage/folder-picker-dialog";
import type { AdapterDefinition } from "@/lib/adapters/definitions";
import { locationValue, type LocationBrowse } from "@/lib/adapters/location-browse";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { ConfigField } from "./connection-form-fields";
import { loginRequired, requiredKeys } from "./connection-form-schema";
import { storageReachKeys } from "./storage-form-layout";

const log = logger.child({ component: "LocationFolderField" });

const filled = (value: unknown) => (typeof value === "string" ? value.trim().length > 0 : value !== undefined && value !== null);

interface LocationFolderFieldProps {
    adapter: AdapterDefinition;
    browse: LocationBrowse;
    /** The saved connection being edited, whose secrets the form does not hold. */
    configId?: string;
    primaryCredentialId: string | null;
    label: string;
    description: string;
}

/**
 * The folder of a storage connection, typed or picked in a browser of the storage. The browser
 * lists the folders with what the form holds, so it works before the connection is saved, and it
 * waits until the form says where the storage is and which login DBackup uses.
 */
export function LocationFolderField({ adapter, browse, configId, primaryCredentialId, label, description }: LocationFolderFieldProps) {
    const { getValues, setValue, watch } = useFormContext();
    const [open, setOpen] = useState(false);
    const config = (watch("config") ?? {}) as Record<string, unknown>;
    const name = (watch("name") as string | undefined)?.trim();
    const ready = requiredKeys(adapter, storageReachKeys(adapter)).every((key) => filled(config[key])) && (!loginRequired(adapter) || primaryCredentialId !== null);

    const list = useCallback(async (path: string): Promise<FolderLevel> => {
        try {
            const res = await fetch("/api/adapters/browse-location", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ adapterId: adapter.id, config: getValues("config"), configId, primaryCredentialId, path }),
            });
            const body = await res.json().catch(() => null);
            if (!body?.success) return { error: body?.error || "The folders could not be listed." };
            return { entries: body.data.entries, unsupported: false };
        } catch (error) {
            log.warn("Listing the folders of a connection failed", { adapterId: adapter.id }, wrapError(error));
            return { error: "The folders could not be listed." };
        }
    }, [adapter.id, configId, primaryCredentialId, getValues]);

    return (
        <>
            <ConfigField
                adapter={adapter}
                fieldKey="pathPrefix"
                label={label}
                description={ready ? description : `${description} Fill in the connection and its login to browse the folders.`}
                browse={{ label: "Browse the folders", disabled: !ready, onOpen: () => setOpen(true) }}
            />
            {/* Mounted per opening, so every visit lists the storage with what the form holds then. */}
            {open && (
                <FolderPickerDialog
                    open
                    onOpenChange={setOpen}
                    list={list}
                    configName={name ? `${name} · ${adapter.name}` : adapter.name}
                    title="Pick the folder"
                    initialPath={typeof config.pathPrefix === "string" ? config.pathPrefix : ""}
                    onSelect={(picked) => setValue("config.pathPrefix", locationValue(browse, picked), { shouldDirty: true, shouldValidate: true })}
                />
            )}
        </>
    );
}
