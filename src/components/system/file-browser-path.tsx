"use client";

import { Fragment, useState } from "react";
import { ChevronRight, HardDrive, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { pathSegments } from "./file-browser-model";

interface FileBrowserPathProps {
    path: string;
    /**
     * The parts to show, each with what `onGo` gets to open it. Taken from the path when not
     * given, and given where a folder is opened by an ID instead of its path.
     */
    segments?: { name: string; path: string }[];
    /** Typing a path replaces the clickable parts until it is sent or cancelled. */
    editing?: boolean;
    /** Without it there is no Type a path. */
    onEditingChange?: (editing: boolean) => void;
    /** Gets "/" for the top. */
    onGo: (path: string) => void;
}

/**
 * Where the browser is, as clickable parts, so any folder on the way is one click back. Type a
 * path swaps the parts for a field, for someone who knows where to go.
 */
export function FileBrowserPath({ path, segments = pathSegments(path), editing = false, onEditingChange, onGo }: FileBrowserPathProps) {
    const [draft, setDraft] = useState(path);

    if (editing && onEditingChange) {
        return (
            <form
                className="flex items-center gap-2"
                onSubmit={(event) => {
                    event.preventDefault();
                    onEditingChange(false);
                    onGo(draft.trim() || "/");
                }}
            >
                <Input
                    autoFocus
                    aria-label="Path"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    className="h-8"
                    spellCheck={false}
                    autoComplete="off"
                />
                <Button type="submit" variant="outline" size="sm">
                    Go
                </Button>
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Stop typing a path" onClick={() => onEditingChange(false)}>
                    <X />
                </Button>
            </form>
        );
    }

    return (
        <div className="flex min-w-0 items-center gap-2">
            <nav aria-label="Path" className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5">
                <Button type="button" variant="ghost" size="icon-sm" className="size-7 text-muted-foreground" aria-label="Go to /" onClick={() => onGo("/")}>
                    <HardDrive />
                </Button>
                {segments.map((segment, index) => {
                    const current = index === segments.length - 1;
                    return (
                        <Fragment key={segment.path}>
                            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                aria-current={current ? "location" : undefined}
                                className={cn("h-7 px-2", current ? "bg-muted font-semibold" : "font-medium text-muted-foreground")}
                                onClick={() => onGo(segment.path)}
                            >
                                {segment.name}
                            </Button>
                        </Fragment>
                    );
                })}
            </nav>
            {onEditingChange && (
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 shrink-0 text-muted-foreground"
                    onClick={() => {
                        setDraft(path);
                        onEditingChange(true);
                    }}
                >
                    <Pencil />
                    Type a path
                </Button>
            )}
        </div>
    );
}
