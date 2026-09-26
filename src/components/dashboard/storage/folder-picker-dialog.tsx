"use client";

import { useEffect, useMemo, useState } from "react";
import { FolderOpen, HardDrive } from "lucide-react";
import { toast } from "sonner";
import { FileBrowserList } from "@/components/system/file-browser-list";
import { visibleEntries, type FileEntry } from "@/components/system/file-browser-model";
import { FileBrowserFilter, FileBrowserFooter, FileBrowserScroll, HiddenToggle } from "@/components/system/file-browser-parts";
import { FileBrowserPath } from "@/components/system/file-browser-path";
import { DIALOG_SURFACE, DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface BrowseEntry {
    name: string;
    /** Opaque identity for the next browse call - a path for most adapters, an ID for Google Drive. */
    path: string;
}

/** One level of the way down. */
interface Crumb {
    name: string;
    /** What the browse API needs to list this level. */
    browsePath: string;
}

type Level = { entries: BrowseEntry[]; unsupported: boolean } | { error: string };

async function listLevel(configId: string, browsePath: string): Promise<Level> {
    try {
        const res = await fetch(`/api/adapters/${configId}/browse?path=${encodeURIComponent(browsePath)}`);
        const body = await res.json();
        if (!body.success) return { error: body.error || "Failed to list the folders" };
        return { entries: body.data.entries, unsupported: body.supported === false };
    } catch {
        return { error: "Network error" };
    }
}

interface FolderPickerDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Storage adapter config to browse. */
    configId: string;
    configName: string;
    /** The path in the field. The picker opens at the deepest folder of it that exists. */
    initialPath?: string;
    /**
     * This adapter has nothing below its root, so there is no folder to descend into and no
     * path to assemble - a Docker volume is picked whole or not at all.
     */
    flat?: boolean;
    /** What one item is called, singular. Wording only. */
    itemNoun?: string;
    /** Called with the chosen folder path, relative to the adapter's root. */
    onSelect: (path: string) => void;
}

/**
 * The folder a restore goes into, on the directory source it goes to. The same browser as a path
 * field, with the folders of the source instead of the disk of the server.
 *
 * The returned path is the names on the way joined with "/". For path-based adapters that is
 * identical to the real relative path, for ID-based adapters (Google Drive) it is the name path,
 * which is what their upload path resolution expects.
 */
export function FolderPickerDialog(props: FolderPickerDialogProps) {
    return (
        <Dialog open={props.open} onOpenChange={props.onOpenChange}>
            <DialogContent tone="pick" showCloseButton={false} className={cn(DIALOG_SURFACE, "sm:max-w-2xl")}>
                {/* Mounted per opening, so every visit starts fresh at the field's value. */}
                <FolderPickerBody {...props} />
            </DialogContent>
        </Dialog>
    );
}

function FolderPickerBody({ onOpenChange, configId, configName, initialPath = "", flat = false, itemNoun = "folder", onSelect }: FolderPickerDialogProps) {
    const [stack, setStack] = useState<Crumb[]>([]);
    const [entries, setEntries] = useState<BrowseEntry[]>([]);
    const [loading, setLoading] = useState(true);
    /** Whether the walk to the field's path is done, so there is a folder to pick. */
    const [arrived, setArrived] = useState(false);
    /** Why the source has no list to show at all, in place of the list. */
    const [problem, setProblem] = useState<string | null>(null);
    const [picked, setPicked] = useState<string | null>(null);
    const [filter, setFilter] = useState("");
    const [showHidden, setShowHidden] = useState(false);

    const show = (crumbs: Crumb[], level: BrowseEntry[]) => {
        setStack(crumbs);
        setEntries(level);
        setPicked(null);
        setFilter("");
    };

    /** Lists a level and goes there, or stays where it is and says why not. */
    const go = async (crumbs: Crumb[]) => {
        setLoading(true);
        const level = await listLevel(configId, crumbs.at(-1)?.browsePath ?? "");
        if ("error" in level) toast.error(level.error);
        else show(crumbs, level.entries);
        setLoading(false);
    };

    // Walks down the path in the field by name, one level at a time, since an ID-based adapter
    // cannot open a path in one step. A target the restore creates stops the walk where it ends.
    useEffect(() => {
        const walk = async () => {
            const root = await listLevel(configId, "");
            if ("error" in root || root.unsupported) {
                setProblem("error" in root ? root.error : `${configName} cannot list its folders. Type the path in the field instead.`);
                setLoading(false);
                return;
            }
            const names = initialPath.split("/").filter(Boolean);
            let crumbs: Crumb[] = [];
            let level = root.entries;
            for (const name of flat ? [] : names) {
                const entry = level.find((candidate) => candidate.name === name);
                if (!entry) break;
                const next = await listLevel(configId, entry.path);
                if ("error" in next) break;
                crumbs = [...crumbs, { name, browsePath: entry.path }];
                level = next.entries;
            }
            show(crumbs, level);
            if (flat) setPicked(level.find((entry) => entry.path === names[0])?.path ?? null);
            setArrived(true);
            setLoading(false);
        };
        void walk();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // A volume is taken with a click like a file, a folder is gone into.
    const rows = useMemo(
        () =>
            visibleEntries(
                entries.map((entry): FileEntry => ({ name: entry.name, path: entry.path, type: flat ? "file" : "directory" })),
                { showHidden, filter, selectionType: flat ? "file" : "directory" }
            ),
        [entries, flat, showHidden, filter]
    );
    const hiddenCount = entries.filter((entry) => entry.name.startsWith(".")).length;

    const here = "/" + stack.map((crumb) => crumb.name).join("/");
    const value = !arrived ? null : flat ? picked : here;
    const use = (path: string) => {
        onSelect(path);
        onOpenChange(false);
    };
    const open = (path: string) => {
        const entry = entries.find((candidate) => candidate.path === path);
        if (entry) void go([...stack, { name: entry.name, browsePath: entry.path }]);
    };
    // A part hands back the browse path of its level, the top "/".
    const jump = (path: string) => void go(stack.slice(0, path === "/" ? 0 : stack.findIndex((crumb) => crumb.browsePath === path) + 1));

    return (
        <>
            <DialogHead tone="pick" icon={flat ? HardDrive : FolderOpen} className="px-5 py-4">
                <DialogTitle className="text-base">Pick the {itemNoun} to restore into</DialogTitle>
                <DialogDescription className={dialogNoteClass("pick")}>{flat ? `${configName} · a ${itemNoun} is restored whole` : configName}</DialogDescription>
            </DialogHead>

            <div className="space-y-2.5 border-b px-4 py-3">
                {!flat && <FileBrowserPath path={here} segments={stack.map((crumb) => ({ name: crumb.name, path: crumb.browsePath }))} onGo={jump} />}
                <FileBrowserFilter value={filter} onChange={setFilter} label={flat ? `Filter the ${itemNoun}s` : undefined} />
            </div>

            <FileBrowserScroll>
                {problem ? (
                    <p className="py-10 text-center text-sm text-muted-foreground">{problem}</p>
                ) : (
                    <FileBrowserList
                        entries={rows}
                        loading={loading}
                        picked={picked}
                        details={false}
                        itemIcon={HardDrive}
                        emptyText={filter ? "Nothing here matches the filter." : flat ? `${configName} has no ${itemNoun}s.` : "There is no folder in this one."}
                        onOpen={open}
                        onPick={setPicked}
                        onUse={use}
                        onUp={() => stack.length > 0 && void go(stack.slice(0, -1))}
                    />
                )}
            </FileBrowserScroll>

            <div className="flex min-h-9 items-center px-4 pb-2">
                <HiddenToggle count={hiddenCount} shown={showHidden} onToggle={() => setShowHidden((current) => !current)} />
            </div>

            <FileBrowserFooter
                chosen={flat ? (entries.find((entry) => entry.path === picked)?.name ?? null) : value}
                action={`Use this ${itemNoun}`}
                disabled={loading}
                onUse={() => value && use(value)}
            />
        </>
    );
}
