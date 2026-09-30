"use client";

import { useState } from "react";
import { Icon } from "@iconify/react";
import githubIcon from "@iconify-icons/simple-icons/github";
import { ArrowUpRight, BookOpen, CircleArrowUp, Sparkles } from "lucide-react";
import { CopyButton } from "@/components/dashboard/history/run-command";
import { Button } from "@/components/ui/button";
import { DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toneAttribute } from "@/components/ui/tone";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const GUIDES_URL = "https://docs.dbackup.app";
const GITHUB_URL = "https://github.com/Skyfay/DBackup";
const RELEASES_URL = "https://github.com/Skyfay/DBackup/releases";
const CHANGELOG_URL = "https://docs.dbackup.app/changelog";
const UPDATE_COMMAND = "docker compose pull && docker compose up -d";

/** One button of the group, like a tab of the view switch. */
const SEGMENT = "inline-flex h-[calc(100%-1px)] items-center justify-center rounded-md px-2.5 text-muted-foreground outline-none transition-[color,background-color,box-shadow] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 [&_svg]:size-4 [&_svg]:shrink-0";
const SEGMENT_ON = "bg-background text-foreground shadow-sm dark:bg-foreground/12";

function LinkSegment({ href, label, children }: { href: string; label: string; children: React.ReactNode }) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <a href={href} target="_blank" rel="noopener noreferrer" aria-label={label} className={SEGMENT}>
                    {children}
                </a>
            </TooltipTrigger>
            <TooltipContent side="bottom">{label}</TooltipContent>
        </Tooltip>
    );
}

interface HeaderLinksProps {
    updateAvailable?: boolean;
    /** The version this DBackup runs, without a v. */
    currentVersion?: string;
    /** The newest release as GitHub names it, like v3.4.0. */
    latestVersion?: string;
}

/**
 * The right of the header: the guides, DBackup on GitHub and, while a newer version is out, the
 * update with a blue dot. One group like the view switch of a list. The update opens a card in the
 * look of the dialogs with how to get it.
 */
export function HeaderLinks({ updateAvailable = false, currentVersion, latestVersion }: HeaderLinksProps) {
    const [open, setOpen] = useState(false);
    const latest = latestVersion ? (latestVersion.startsWith("v") ? latestVersion : `v${latestVersion}`) : "A new version";

    return (
        <div className="inline-flex h-9 items-center rounded-lg bg-muted p-0.75">
            <LinkSegment href={GUIDES_URL} label="Guides">
                <BookOpen aria-hidden="true" />
            </LinkSegment>
            <LinkSegment href={GITHUB_URL} label="DBackup on GitHub">
                <Icon icon={githubIcon} aria-hidden="true" />
            </LinkSegment>
            {updateAvailable && (
                <Popover open={open} onOpenChange={setOpen}>
                    <PopoverTrigger asChild>
                        <button type="button" aria-label={`${latest} is out`} {...toneAttribute("create")} className={cn(SEGMENT, "relative text-tone hover:text-tone", open && SEGMENT_ON)}>
                            <CircleArrowUp aria-hidden="true" />
                            <span className="absolute top-1 right-1.5 size-1.75 rounded-full bg-tone ring-2 ring-muted" aria-hidden="true" />
                        </button>
                    </PopoverTrigger>
                    <PopoverContent tone="create" align="end" className="w-100 overflow-hidden bg-card p-0">
                        <DialogHead tone="create" icon={CircleArrowUp} className="px-4 py-3">
                            <p className="text-sm font-semibold">DBackup {latest} is out</p>
                            <p className={dialogNoteClass("create")}>{currentVersion ? `You run v${currentVersion}` : "A newer version than this one"}</p>
                        </DialogHead>
                        <div className="space-y-2 px-4 py-3.5">
                            <p className="text-sm">Pull the new image and start the container again. The migrations run by themselves.</p>
                            <div className="flex items-center gap-2 rounded-lg border bg-muted/40 py-1.5 pr-1.5 pl-3">
                                <code className="min-w-0 flex-1 truncate font-mono text-xs">{UPDATE_COMMAND}</code>
                                <CopyButton text={UPDATE_COMMAND} />
                            </div>
                        </div>
                        <div className="flex justify-end gap-2 border-t bg-page/60 px-4 py-3">
                            <Button variant="outline" size="sm" asChild>
                                <a href={RELEASES_URL} target="_blank" rel="noopener noreferrer">
                                    <ArrowUpRight />
                                    Release on GitHub
                                </a>
                            </Button>
                            <Button tone="create" size="sm" asChild>
                                <a href={CHANGELOG_URL} target="_blank" rel="noopener noreferrer">
                                    <Sparkles />
                                    What&apos;s new
                                </a>
                            </Button>
                        </div>
                    </PopoverContent>
                </Popover>
            )}
        </div>
    );
}
