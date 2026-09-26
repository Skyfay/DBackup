"use client";

import { CircleCheck, Clock, Link2, Loader2, RefreshCw } from "lucide-react";
import { Notice } from "@/components/dashboard/storage/restore/restore-parts";
import { Button } from "@/components/ui/button";
import { useDateFormatter } from "@/hooks/use-date-formatter";
import { cn } from "@/lib/utils";
import type { DownloadLink } from "./use-download-link";

function minutes(seconds: number): string {
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function capital(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

interface LinkLineProps {
    link: DownloadLink;
    canDownload: boolean;
    /** What holds the link, like "the command" or "the commands". */
    holder: string;
    plural?: boolean;
    onCreate: () => void;
    /** Why no link can be made yet, like a pick that is still empty. */
    blocked?: string | null;
}

/**
 * Whether the commands hold a link that works, with the way to make one or a new one. A link
 * works for one download, so the line says when it was fetched and asks for a new one then.
 */
export function LinkLine({ link, canDownload, holder, plural = false, onCreate, blocked }: LinkLineProps) {
    const { formatDate } = useDateFormatter();
    if (!canDownload) {
        return (
            <Notice tone="warning" title="The link needs the Download permission">
                {capital(holder)} fetch{plural ? "" : "es"} the backup with a download link, which only a user who may download backups can make.
            </Notice>
        );
    }

    const make = (label: string, Icon: typeof Link2) => (
        <Button variant="outline" size="sm" onClick={onCreate} disabled={link.creating || !!blocked} className="flex-1 sm:flex-none">
            {link.creating ? <Loader2 className="animate-spin" /> : <Icon />}
            {label}
        </Button>
    );
    const line = (tone: "muted" | "success" | "warning", Icon: typeof Link2, title: string, text: React.ReactNode, action: React.ReactNode) => (
        <div
            className={cn(
                "flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2.5 text-sm",
                tone === "success" ? "border-success/30 bg-success/5" : tone === "warning" ? "border-warning/30 bg-warning/5" : "bg-muted/40",
            )}
        >
            <Icon className={cn("size-4 shrink-0", tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : "text-muted-foreground")} aria-hidden="true" />
            <div className="min-w-0 flex-1">
                <p className="font-medium">{title}</p>
                <p className="text-muted-foreground">{text}</p>
            </div>
            {action}
        </div>
    );

    if (link.fetched) {
        const where = link.fetched.from ? ` from ${link.fetched.from}` : "";
        return line("warning", CircleCheck, `Fetched at ${formatDate(new Date(link.fetched.at), "p")}${where}`,
            `A link works for one download, so running ${plural ? "them" : "it"} again needs a new one.`, make("New link", RefreshCw));
    }
    if (link.expired) {
        return line("warning", Clock, `The link in ${holder} ran out`, "Nobody fetched it within five minutes. A new one takes a click.", make("New link", RefreshCw));
    }
    if (link.url) {
        return line("success", CircleCheck, `The link is in ${holder}`, (
            <>
                It works for one download and runs out in <span className="tabular-nums">{minutes(link.secondsLeft)}</span>. Nobody has fetched it yet.
            </>
        ), make("New link", RefreshCw));
    }
    return line("muted", Link2, `${capital(holder)} need${plural ? "" : "s"} a download link`,
        blocked ?? `It works for one download within five minutes, so make it right before you run ${plural ? "them" : "it"}.`, make("Make the link", Link2));
}
