"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Database, File, FolderOpen } from "lucide-react";
import { toast } from "sonner";
import { DIALOG_SURFACE, DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { FileBrowserList } from "./file-browser-list";
import { fits, parentOf, visibleEntries, type FileAccept, type FolderListing } from "./file-browser-model";
import { FileBrowserFilter, FileBrowserFooter, FileBrowserScroll, HiddenToggle } from "./file-browser-parts";
import { FileBrowserPath } from "./file-browser-path";

interface FileBrowserDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSelect: (path: string) => void;
    /** The value of the field. A folder opens, a file opens its folder with the file picked. */
    initialPath?: string;
    /** A file is picked with a click, a folder by going into it and using the one you are in. */
    selectionType?: "file" | "directory";
    /** Like "Pick the database file". */
    title: string;
    /** The files the field takes, marked while the others are dimmed. */
    accept?: FileAccept;
    /** When set, the browser lists the server of this SSH config instead of this machine. */
    remoteConfig?: Record<string, unknown> | null;
    remoteAdapterId?: string;
    remoteSshCredentialId?: string | null;
}

/**
 * Picks a file or a folder for a path field, on this machine or on a server over SSH. Headed in
 * the turquoise of picking, with the path as clickable parts, a filter and the picked path above
 * the buttons.
 */
export function FileBrowserDialog(props: FileBrowserDialogProps) {
    // Escape leaves a path being typed before it closes the browser. The body says whether it did.
    const escape = useRef<(() => boolean) | null>(null);
    return (
        <Dialog open={props.open} onOpenChange={props.onOpenChange}>
            <DialogContent
                tone="pick"
                showCloseButton={false}
                className={cn(DIALOG_SURFACE, "sm:max-w-2xl")}
                onEscapeKeyDown={(event) => escape.current?.() && event.preventDefault()}
            >
                {/* Mounted per opening, so every visit starts fresh at the field's value. */}
                <FileBrowserBody {...props} escapeRef={escape} />
            </DialogContent>
        </Dialog>
    );
}

function FileBrowserBody({
    escapeRef,
    onOpenChange,
    onSelect,
    initialPath = "/",
    selectionType = "file",
    title,
    accept,
    remoteConfig,
    remoteAdapterId,
    remoteSshCredentialId,
}: FileBrowserDialogProps & { escapeRef: React.RefObject<(() => boolean) | null> }) {
    const [listing, setListing] = useState<FolderListing | null>(null);
    const [loading, setLoading] = useState(true);
    const [picked, setPicked] = useState<string | null>(null);
    const [filter, setFilter] = useState("");
    const [showHidden, setShowHidden] = useState(false);
    const [editingPath, setEditingPath] = useState(false);

    // The form hands a fresh config object on every render, so the request reads it from here
    // instead of depending on it.
    const remote = useRef({ remoteConfig, remoteAdapterId, remoteSshCredentialId });
    remote.current = { remoteConfig, remoteAdapterId, remoteSshCredentialId };

    const request = async (path: string): Promise<{ data?: FolderListing; error?: string }> => {
        const { remoteConfig: config, remoteAdapterId: adapterId, remoteSshCredentialId: sshCredentialId } = remote.current;
        try {
            const res = config
                ? await fetch("/api/system/filesystem/remote", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ config, path, adapterId, sshCredentialId: sshCredentialId ?? null }),
                  })
                : await fetch(`/api/system/filesystem?${new URLSearchParams({ path }).toString()}`);
            const json = await res.json();
            return json.success ? { data: json.data as FolderListing } : { error: json.error || "Failed to load directory" };
        } catch {
            return { error: "Network error" };
        }
    };

    const show = (data: FolderListing, pick: string | null = null) => {
        setListing(data);
        setPicked(pick);
        setFilter("");
    };

    /** A file path opens its folder with the file picked, when the file is there. */
    const openAt = async (path: string, fallBackToRoot: boolean) => {
        setLoading(true);
        const result = await request(path);
        if (result.data) {
            show(result.data);
        } else {
            const parent = await request(parentOf(path));
            if (parent.data) {
                const file = parent.data.entries.find((entry) => entry.type === "file" && entry.path === path);
                show(parent.data, selectionType === "file" && file ? file.path : null);
            } else if (fallBackToRoot) {
                const root = await request("/");
                if (root.data) show(root.data);
                else toast.error(root.error ?? "Failed to load directory");
            } else {
                toast.error(result.error ?? "Failed to load directory");
            }
        }
        setLoading(false);
    };

    const openFolder = async (path: string) => {
        setLoading(true);
        const result = await request(path);
        if (result.data) show(result.data);
        else toast.error(result.error ?? "Failed to load directory");
        setLoading(false);
    };

    useEffect(() => {
        escapeRef.current = () => {
            if (!editingPath) return false;
            setEditingPath(false);
            return true;
        };
    });

    // Starts where the field points, once per opening. A path that is gone falls back to "/".
    useEffect(() => {
        void openAt(initialPath && initialPath.startsWith("/") ? initialPath : "/", true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const entries = useMemo(
        () => visibleEntries(listing?.entries ?? [], { showHidden, filter, selectionType }),
        [listing, showHidden, filter, selectionType]
    );
    const hiddenCount = (listing?.entries ?? []).filter((entry) => entry.name.startsWith(".")).length;
    const dimmedCount = accept ? entries.filter((entry) => entry.type === "file" && !fits(entry.name, accept)).length : 0;

    const currentPath = listing?.currentPath ?? "/";
    const chosen = selectionType === "file" ? picked : listing ? currentPath : null;
    const use = (path: string) => {
        onSelect(path);
        onOpenChange(false);
    };
    const goUp = () => {
        if (listing && listing.parentPath !== currentPath) void openFolder(listing.parentPath);
    };

    const where = remoteConfig?.host ? `${String(remoteConfig.host)} over SSH` : "This machine";
    const note = accept ? `${where} · ${accept.label} file` : where;
    const Icon = selectionType === "directory" ? FolderOpen : accept ? Database : File;

    return (
        <>
            <DialogHead tone="pick" icon={Icon} className="px-5 py-4">
                <DialogTitle className="text-base">{title}</DialogTitle>
                <DialogDescription className={dialogNoteClass("pick")}>{note}</DialogDescription>
            </DialogHead>

            <div className="space-y-2.5 border-b px-4 py-3">
                <FileBrowserPath path={currentPath} editing={editingPath} onEditingChange={setEditingPath} onGo={(path) => void openAt(path, false)} />
                <FileBrowserFilter value={filter} onChange={setFilter} />
            </div>

            <div className="hidden items-center gap-2.5 px-5 pt-2 text-xs font-medium text-muted-foreground sm:flex" aria-hidden="true">
                <span className="size-4" />
                <span className="flex-1">Name</span>
                <span className="w-20 text-right">Size</span>
                <span className="w-28 text-right">Modified</span>
                <span className="size-4" />
            </div>
            <FileBrowserScroll>
                <FileBrowserList
                    entries={entries}
                    loading={loading}
                    picked={picked}
                    accept={accept}
                    emptyText={filter ? "Nothing here matches the filter." : "This folder is empty."}
                    onOpen={(path) => void openFolder(path)}
                    onPick={setPicked}
                    onUse={use}
                    onUp={goUp}
                />
            </FileBrowserScroll>

            <div className="flex min-h-9 flex-wrap items-center justify-between gap-2 px-4 pb-2 text-xs text-muted-foreground">
                <HiddenToggle count={hiddenCount} shown={showHidden} onToggle={() => setShowHidden((current) => !current)} />
                {accept && dimmedCount > 0 && (
                    <span className="px-2">
                        {dimmedCount} {dimmedCount === 1 ? "file is" : "files are"} no {accept.label} file
                    </span>
                )}
            </div>

            <FileBrowserFooter
                chosen={chosen}
                action={selectionType === "file" ? "Use this file" : "Use this folder"}
                disabled={loading}
                onUse={() => chosen && use(chosen)}
            />
        </>
    );
}
