"use client";

import { Check, ChevronRight, Database, File, Folder } from "lucide-react";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { Skeleton } from "@/components/ui/skeleton";
import { useDateFormatter } from "@/hooks/use-date-formatter";
import { cn, formatBytes } from "@/lib/utils";
import { fits, type FileAccept, type FileEntry } from "./file-browser-model";

interface FileBrowserListProps {
    entries: FileEntry[];
    loading: boolean;
    picked: string | null;
    accept?: FileAccept;
    /** What an empty list says, which depends on whether a filter is set. */
    emptyText: string;
    onOpen: (path: string) => void;
    onPick: (path: string) => void;
    /** A double click on a file picks it and closes the browser. */
    onUse: (path: string) => void;
    onUp: () => void;
}

/**
 * The entries of one folder. A click opens a folder and picks a file. Every row is a button, so
 * Tab reaches the list, the arrow keys move within it and Backspace goes one folder up.
 */
export function FileBrowserList({ entries, loading, picked, accept, emptyText, onOpen, onPick, onUse, onUp }: FileBrowserListProps) {
    const { formatDate } = useDateFormatter();

    const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "Backspace") {
            event.preventDefault();
            onUp();
            return;
        }
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault();
        const rows = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("[data-entry]"));
        const index = rows.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "ArrowDown" ? Math.min(index + 1, rows.length - 1) : Math.max(index - 1, 0);
        rows[next]?.focus();
    };

    if (loading) {
        return (
            <div className="space-y-1.5 p-1" aria-busy="true">
                {Array.from({ length: 7 }, (_, index) => (
                    <Skeleton key={index} className="h-8 w-full" />
                ))}
            </div>
        );
    }
    if (entries.length === 0) return <p className="py-10 text-center text-sm text-muted-foreground">{emptyText}</p>;

    return (
        <div className="space-y-0.5" onKeyDown={onKeyDown}>
            {entries.map((entry) => {
                const isFolder = entry.type === "directory";
                const fit = isFolder || fits(entry.name, accept);
                const isPicked = !isFolder && picked === entry.path;
                const Icon = isFolder ? Folder : accept && fit ? Database : File;
                return (
                    <button
                        key={entry.path}
                        type="button"
                        data-entry
                        onClick={() => (isFolder ? onOpen(entry.path) : onPick(entry.path))}
                        onDoubleClick={() => !isFolder && onUse(entry.path)}
                        className={cn(
                            "flex w-full items-center gap-2.5 rounded-lg border border-transparent px-2.5 py-1.5 text-left text-sm outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-tone-ring/50",
                            isPicked && "border-tone-control/60 bg-tone-control/5 hover:bg-tone-control/10 dark:bg-tone-control/10",
                            !fit && "opacity-60"
                        )}
                    >
                        <Icon className={cn("size-4 shrink-0", isPicked ? "text-tone-control" : fit && !isFolder ? "text-foreground" : "text-muted-foreground")} aria-hidden="true" />
                        <span className="flex min-w-0 flex-1 items-center gap-2">
                            <span className={cn("truncate", isPicked && "font-medium")}>{entry.name}</span>
                            {accept && fit && !isFolder && (
                                <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">{accept.label}</span>
                            )}
                        </span>
                        <span className="hidden w-20 shrink-0 text-right text-xs text-muted-foreground tabular-nums sm:block">
                            {!isFolder && entry.size !== undefined ? formatBytes(entry.size, 1) : ""}
                        </span>
                        <span className="hidden w-28 shrink-0 text-right text-xs text-muted-foreground sm:block" title={entry.modified ? formatDate(entry.modified) : undefined}>
                            {entry.modified && <RelativeTime date={entry.modified} />}
                        </span>
                        {isFolder ? (
                            <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        ) : isPicked ? (
                            <>
                                <Check className="size-4 shrink-0 text-tone-control" aria-hidden="true" />
                                <span className="sr-only">Picked</span>
                            </>
                        ) : (
                            <span className="size-4 shrink-0" aria-hidden="true" />
                        )}
                    </button>
                );
            })}
        </div>
    );
}
