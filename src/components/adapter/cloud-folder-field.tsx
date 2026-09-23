"use client";

import { useId, useState } from "react";
import { useFormContext } from "react-hook-form";
import { FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DropboxFolderBrowser } from "./dropbox-folder-browser";
import { GoogleDriveFolderBrowser } from "./google-drive-folder-browser";
import { OneDriveFolderBrowser } from "./onedrive-folder-browser";

const DRIVE_NAMES: Record<string, string> = {
    "google-drive": "Google Drive",
    dropbox: "Dropbox",
    onedrive: "OneDrive",
};

/**
 * The folder of a cloud drive, typed or picked in its browser.
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
    const [folderName, setFolderName] = useState<string | null>(null);
    const isGoogle = adapterId === "google-drive";
    const key = isGoogle ? "config.folderId" : "config.folderPath";
    const value: string = watch(key) || "";
    const drive = DRIVE_NAMES[adapterId] ?? "the drive";
    const canBrowse = authorized && !!credentialId;

    const pick = (next: string, name?: string) => {
        setValue(key, next, { shouldDirty: true });
        setFolderName(name ?? null);
    };

    let note = description;
    if (!canBrowse) note = `Authorize ${drive} first to browse its folders.`;
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
                    aria-label={`Browse ${drive} folders`}
                >
                    <FolderOpen />
                </Button>
            </div>
            {note && <p className="text-xs text-muted-foreground">{note}</p>}

            {canBrowse && isGoogle && (
                <GoogleDriveFolderBrowser
                    open={browsing}
                    onOpenChange={setBrowsing}
                    onSelect={(folderId, name) => pick(folderId, name)}
                    credentialId={credentialId!}
                    initialFolderId={value || undefined}
                />
            )}
            {canBrowse && adapterId === "dropbox" && (
                <DropboxFolderBrowser open={browsing} onOpenChange={setBrowsing} onSelect={(path) => pick(path)} credentialId={credentialId!} initialPath={value || undefined} />
            )}
            {canBrowse && adapterId === "onedrive" && (
                <OneDriveFolderBrowser open={browsing} onOpenChange={setBrowsing} onSelect={(path) => pick(path)} credentialId={credentialId!} initialPath={value || undefined} />
            )}
        </div>
    );
}
