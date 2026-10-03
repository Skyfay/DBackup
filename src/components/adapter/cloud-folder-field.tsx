"use client";

import { useId, useState } from "react";
import { useFormContext } from "react-hook-form";
import { FolderOpen } from "lucide-react";
import { FolderPickerDialog, type BrowseEntry, type FolderLevel } from "@/components/dashboard/storage/folder-picker-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";

const log = logger.child({ component: "CloudFolderField" });

/** The drives with a folder browser, and what the body of their browse route names a folder by. */
const DRIVES: Record<string, { name: string; folderKey: "folderId" | "folderPath" }> = {
    "google-drive": { name: "Google Drive", folderKey: "folderId" },
    dropbox: { name: "Dropbox", folderKey: "folderPath" },
    onedrive: { name: "OneDrive", folderKey: "folderPath" },
};

interface DriveAnswer {
    success?: boolean;
    error?: string;
    data?: { entries?: BrowseEntry[]; trail?: BrowseEntry[] };
}

/** Asks the browse route of a drive, which lists one level of its folders, or with `trail` the folders down to one. */
async function askDrive(adapterId: string, body: Record<string, unknown>): Promise<DriveAnswer | null> {
    try {
        const res = await fetch(`/api/system/filesystem/${adapterId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        return (await res.json().catch(() => null)) as DriveAnswer | null;
    } catch (error) {
        log.warn("Browsing the folders of a drive failed", { adapterId }, wrapError(error));
        return null;
    }
}

/**
 * The folder of a cloud drive, typed or picked in the folder browser of the other connections.
 *
 * Google Drive knows folders by ID, the others by path. The browser needs an authorized
 * OAuth app, so it stays off until there is one.
 */
export function CloudFolderField({ adapterId, authorized, credentialId, description }: {
    adapterId: string;
    authorized: boolean;
    credentialId?: string;
    /** What the folder is for, shown once the browser can be used. */
    description?: string;
}) {
    const { setValue, watch } = useFormContext();
    const id = useId();
    const [browsing, setBrowsing] = useState(false);
    /** The path of the Google Drive folder picked last, since the field only shows its ID. */
    const [folderName, setFolderName] = useState<string | null>(null);
    const isGoogle = adapterId === "google-drive";
    const key = isGoogle ? "config.folderId" : "config.folderPath";
    const value: string = watch(key) || "";
    const name = (watch("name") as string | undefined)?.trim();
    const drive = DRIVES[adapterId];
    const driveName = drive?.name ?? "the drive";
    const canBrowse = !!drive && authorized && !!credentialId;

    const pick = (next: string, picked?: string) => {
        setValue(key, next, { shouldDirty: true });
        setFolderName(picked ?? null);
    };

    const list = async (browsePath: string): Promise<FolderLevel> => {
        const answer = await askDrive(adapterId, { credentialId, [drive.folderKey]: browsePath });
        if (!answer?.success || !answer.data?.entries) return { error: answer?.error || `The folders of ${driveName} could not be listed.` };
        return { entries: answer.data.entries.map((entry) => ({ name: entry.name, path: entry.path })), unsupported: false };
    };
    // A Google Drive field holds an ID, which its route turns into the folders on the way down.
    const locate = async (): Promise<BrowseEntry[]> => {
        const answer = await askDrive(adapterId, { credentialId, folderId: value, trail: true });
        return answer?.success ? (answer.data?.trail ?? []) : [];
    };
    // The top of a drive is an empty field, and a Google Drive folder goes in by its ID.
    const choose = (path: string, browsePath: string) => {
        if (isGoogle) pick(browsePath, path === "/" ? undefined : path);
        else pick(path === "/" ? "" : path);
    };

    let note = description;
    if (!canBrowse) note = `Authorize ${driveName} first to browse its folders.`;
    else if (isGoogle && folderName && value) note = `Picked: ${folderName}`;

    return (
        <div className="grid gap-2">
            <div className="flex items-baseline justify-between gap-3">
                <Label htmlFor={id}>{isGoogle ? "Folder ID" : "Folder"}</Label>
                <span className="text-xs text-muted-foreground">Optional</span>
            </div>
            <div className="flex gap-2">
                <Input
                    id={id}
                    value={value}
                    onChange={(event) => pick(event.target.value)}
                    placeholder={isGoogle ? "Leave empty for My Drive" : "Leave empty for the top folder, or like /backups"}
                    className="font-mono text-sm"
                />
                <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => setBrowsing(true)}
                    disabled={!canBrowse}
                    aria-label={`Browse ${driveName} folders`}
                >
                    <FolderOpen />
                </Button>
            </div>
            {note && <p className="text-xs text-muted-foreground">{note}</p>}

            {canBrowse && (
                <FolderPickerDialog
                    open={browsing}
                    onOpenChange={setBrowsing}
                    list={list}
                    configName={name ? `${name} · ${driveName}` : driveName}
                    title="Pick the folder"
                    initialPath={isGoogle ? "" : value}
                    locate={isGoogle && value ? locate : undefined}
                    onSelect={choose}
                />
            )}
        </div>
    );
}
