"use client";

import { useState } from "react";
import { Database, Download, FileLock2, FolderOpen, RotateCw } from "lucide-react";
import type { KeyResolutionResult } from "@/components/common/encryption-key-resolution-dialog";
import { madeAt } from "@/components/dashboard/storage/explorer/explorer-format";
import { startPreparedArchiveDownload } from "@/components/dashboard/storage/prepared-download";
import { Notice } from "@/components/dashboard/storage/restore/restore-parts";
import { Button } from "@/components/ui/button";
import { DIALOG_FOOTER, DIALOG_SURFACE, DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDateFormatter } from "@/hooks/use-date-formatter";
import { keyOverrideBody, type KeyOverrideBody } from "@/hooks/use-encryption-key-recovery";
import { cn, formatBytes } from "@/lib/utils";
import type { ExplorerFile } from "@/services/storage/explorer-types";
import { DownloadAction, type Where } from "./download-action";
import { outputOf, pickNote, pickTitle, requestOf, type DownloadItem, type Tool } from "./download-model";
import { PickGroup, SingleFilesButton } from "./download-pick";
import { useBackupContents, type InterceptKeyRequest } from "./use-backup-contents";
import { useDownloadLink } from "./use-download-link";

type Mode = "unpacked" | "decrypted" | "stored";

const bytes = (value: number) => formatBytes(value, 1);

interface DownloadDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    destinationId: string;
    file: ExplorerFile;
    /** The key the page settled on for this backup, if a prompt happened earlier. */
    keyOverride?: KeyOverrideBody;
    /** The page's key prompt. Returns true when it took the response over. */
    interceptKeyRequest: InterceptKeyRequest;
    /** Downloads the file exactly as the destination stores it. */
    onStored: () => void;
    /** Downloads an older backup decrypted as a whole. */
    onDecrypted: () => void;
    /** Opens the files of the backup on the restore page. Absent without the restore right. */
    onSingleFiles?: () => void;
}

/**
 * Every download of a backup in one dialog. A seekable backup lists its databases and folders
 * to tick, one database comes as its dump and any mix as one tar.gz, streamed either way. The
 * file as stored, and an older backup decrypted as a whole, are a switch away. Each goes to
 * this computer or, as a command with a link for one download, to another host.
 */
export function DownloadDialog({ open, onOpenChange, destinationId, file, keyOverride, interceptKeyRequest, onStored, onDecrypted, onSingleFiles }: DownloadDialogProps) {
    const { formatDate } = useDateFormatter();
    const seekable = !!file.hasFileIndex;
    // LEGACY-FORMAT(shared): A backup without a file index, an older database backup or a config backup,
    // only downloads as a whole. Keep this branch for the config backups.
    const modes: Mode[] = seekable ? ["unpacked", "stored"] : file.isEncrypted ? ["decrypted", "stored"] : ["stored"];
    const [mode, setMode] = useState<Mode>(modes[0]);
    const [where, setWhere] = useState<Where>("here");
    const [tool, setTool] = useState<Tool>("curl");
    const [pickedDatabases, setPickedDatabases] = useState<Set<string>>(new Set());
    const [pickedFolders, setPickedFolders] = useState<Set<string>>(new Set());
    const contents = useBackupContents({ open, destinationId, file, keyOverride, interceptKeyRequest });
    const link = useDownloadLink(destinationId, file.path, {
        intercept: (res, retry) => interceptKeyRequest(res, (result) => retry({ ...keyOverrideBody(result) })),
    });

    // A link names what it fetches, so it goes whenever that changes.
    const change = <T,>(set: (value: T) => void) => (value: T) => {
        set(value);
        link.reset();
    };

    const databases = contents.databases.filter((item) => pickedDatabases.has(item.id));
    const folders = contents.folders.filter((item) => pickedFolders.has(item.id));
    const output = outputOf(databases, folders);
    const plainName = file.name.replace(/\.enc$/, "");

    const downloadPicked = async (resolved?: KeyResolutionResult) => {
        await startPreparedArchiveDownload({
            destinationId,
            body: { file: file.path, ...requestOf(databases, folders), ...(resolved ? keyOverrideBody(resolved) : keyOverride) },
            intercept: (res) => interceptKeyRequest(res, (result) => downloadPicked(result)),
            preparingLabel: `Preparing ${pickTitle(databases, folders, { databases: contents.databases.length, folders: contents.folders.length })}...`,
        });
    };

    const action = mode === "unpacked"
        ? {
            title: pickTitle(databases, folders, { databases: contents.databases.length, folders: contents.folders.length }),
            note: pickNote(databases, folders, bytes),
            blocked: output === null ? "Tick what you need first." : null,
            hereLabel: output === "dump" ? `Download ${databases[0].name}` : "Download as one tar.gz",
            onHere: () => void downloadPicked(),
            onLink: () => void link.create({ ...requestOf(databases, folders), ...keyOverride }),
            fileName: output === "dump" ? `${databases[0].name}.dump` : `${plainName.replace(/\.tar$/, "")}.tar.gz`,
        }
        : mode === "decrypted"
            ? {
                title: plainName,
                note: `${bytes(file.size)} · the whole backup, decrypted`,
                blocked: null,
                hereLabel: "Download decrypted",
                onHere: onDecrypted,
                onLink: () => void link.create({ decrypt: true }),
                fileName: plainName,
            }
            : {
                title: file.name,
                note: `${bytes(file.size)} · exactly the file at the destination${file.isEncrypted ? ", encrypted" : ""}`,
                blocked: null,
                hereLabel: "Download as stored",
                onHere: onStored,
                onLink: () => void link.create({ decrypt: false }),
                fileName: file.name,
            };

    const modeLabel = (value: Mode) => (value === "unpacked" ? "Unpacked" : value === "decrypted" ? "Decrypted" : file.isEncrypted ? "As stored, encrypted" : "As stored");
    const modeNote = {
        unpacked: "Tick what you need. One database comes as its dump, more as one tar.gz.",
        decrypted: "An older backup, decrypted as a whole.",
        stored: file.isEncrypted ? "The file as the destination holds it. The Recovery Kit opens it with the key." : "The file as the destination holds it.",
    }[mode];
    const made = Date.parse(madeAt(file));

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent showCloseButton={false} className={cn(DIALOG_SURFACE, "sm:max-w-2xl")}>
                <div className="flex max-h-[90dvh] min-h-0 flex-col">
                    <DialogHead tone="neutral" icon={Download}>
                        <DialogTitle className="truncate text-base">Download {file.jobName ?? file.name}</DialogTitle>
                        <DialogDescription className={cn(dialogNoteClass("neutral"), "truncate")}>
                            {[Number.isFinite(made) ? formatDate(new Date(made), "Pp") : null, bytes(file.size), file.isEncrypted ? "Encrypted" : null].filter(Boolean).join(" · ")}
                        </DialogDescription>
                    </DialogHead>

                    <ScrollArea className="min-h-0 flex-1 *:data-[slot=scroll-area-viewport]:max-h-[calc(90dvh-9rem)]">
                        <div className="space-y-4 p-5">
                            {modes.length > 1 && (
                                <div className="flex flex-wrap items-center gap-3">
                                    <Tabs value={mode} onValueChange={(value) => change(setMode)(value as Mode)} className="gap-0">
                                        <TabsList className="h-8" aria-label="What to download">
                                            {modes.map((value) => (
                                                <TabsTrigger key={value} value={value} className="px-2.5 text-xs">{modeLabel(value)}</TabsTrigger>
                                            ))}
                                        </TabsList>
                                    </Tabs>
                                    <p className="min-w-0 flex-1 text-xs text-muted-foreground">{modeNote}</p>
                                </div>
                            )}

                            {mode === "unpacked" ? (
                                <Contents
                                    contents={contents}
                                    pickedDatabases={pickedDatabases}
                                    pickedFolders={pickedFolders}
                                    onDatabases={change(setPickedDatabases)}
                                    onFolders={change(setPickedFolders)}
                                    onSingleFiles={onSingleFiles}
                                />
                            ) : (
                                <div className="flex items-center gap-3 rounded-lg border px-3 py-2.5">
                                    <FileLock2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                                    <span className="grid min-w-0 flex-1 gap-0.5">
                                        <span className="truncate text-sm font-medium">{action.title}</span>
                                        <span className="text-xs text-muted-foreground">{modes.length > 1 ? action.note : modeNote}</span>
                                    </span>
                                </div>
                            )}

                            <DownloadAction
                                {...action}
                                where={where}
                                onWhere={setWhere}
                                tool={tool}
                                onTool={setTool}
                                link={link}
                                canDownload
                            />
                        </div>
                    </ScrollArea>

                    <div className={cn(DIALOG_FOOTER, "flex justify-end")}>
                        {/* Nothing to confirm here, so it closes like the other dialogs that only show something. */}
                        <DialogClose asChild>
                            <Button type="button" variant="outline">Close</Button>
                        </DialogClose>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

interface ContentsProps {
    contents: ReturnType<typeof useBackupContents>;
    pickedDatabases: Set<string>;
    pickedFolders: Set<string>;
    onDatabases: (next: Set<string>) => void;
    onFolders: (next: Set<string>) => void;
    onSingleFiles?: () => void;
}

/** The databases and folders of the backup, as groups to tick. */
function Contents({ contents, pickedDatabases, pickedFolders, onDatabases, onFolders, onSingleFiles }: ContentsProps) {
    if (contents.loading) {
        return (
            <div className="space-y-2" aria-busy="true" aria-label="Reading what the backup holds">
                <Skeleton className="h-12 w-full rounded-lg" />
                <Skeleton className="h-32 w-full rounded-lg" />
            </div>
        );
    }
    if (contents.error) {
        return (
            <Notice tone="destructive" title="This backup could not be read">
                {contents.error}{" "}
                <Button variant="link" className="h-auto p-0" onClick={contents.retry}>
                    <RotateCw className="size-3.5" />
                    Try again
                </Button>
            </Notice>
        );
    }
    if (contents.databases.length === 0 && contents.folders.length === 0) {
        return <p className="rounded-lg border px-3 py-2.5 text-sm text-muted-foreground">This backup lists nothing to pick. Download it as stored instead.</p>;
    }
    const single = (item: DownloadItem) => (onSingleFiles ? <SingleFilesButton name={item.name} onOpen={onSingleFiles} /> : null);
    return (
        <div className="space-y-3">
            {contents.databases.length > 0 && <PickGroup label="Databases" icon={Database} items={contents.databases} picked={pickedDatabases} onPicked={onDatabases} />}
            {contents.folders.length > 0 && <PickGroup label="Folders" icon={FolderOpen} items={contents.folders} picked={pickedFolders} onPicked={onFolders} rowAction={single} />}
        </div>
    );
}
