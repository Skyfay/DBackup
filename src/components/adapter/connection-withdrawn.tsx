"use client";

import { useEffect, useState } from "react";
import { Unlink, X } from "lucide-react";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { Button } from "@/components/ui/button";
import type { WithdrawnConnection } from "@/services/sharing/withdrawn";

const HIDDEN_KEY = "dbackup.connections.withdrawn-hidden";

const plural = (count: number, one: string, many: string) => `${count.toLocaleString()} ${count === 1 ? one : many}`;

/** The names of a list, the first three and how many more. */
function listed(names: string[]): string {
    if (names.length <= 3) return names.join(", ");
    return `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
}

/** What the tenant lost with the connection, in one sentence. */
function lossOf(note: WithdrawnConnection): string {
    const parts: string[] = [];
    if (note.kind === "destination") {
        if (note.backups > 0) parts.push(`${plural(note.backups, "backup", "backups")} of this tenant on it were deleted.`);
        if (note.jobs.length > 0) parts.push(`${plural(note.jobs.length, "job", "jobs")} no longer write to it: ${listed(note.jobs)}. Give them another destination.`);
    } else {
        if (note.jobs.length > 0) parts.push(`${plural(note.jobs.length, "job", "jobs")} no longer tell it: ${listed(note.jobs)}.`);
        if (note.templates.length > 0) parts.push(`${plural(note.templates.length, "template", "templates")} no longer send to it: ${listed(note.templates)}.`);
    }
    return parts.join(" ") || "Nothing of this tenant used it.";
}

/**
 * The destinations or channels another tenant stopped sharing with this one in the last two weeks,
 * above the list they were in. Hide keeps a note away in this browser.
 */
export function WithdrawnNotes({ notes }: { notes: WithdrawnConnection[] }) {
    const [hidden, setHidden] = useState<string[] | null>(null);

    useEffect(() => {
        try {
            const stored = JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]");
            setHidden(Array.isArray(stored) ? stored.filter((entry): entry is string => typeof entry === "string") : []);
        } catch {
            // A private window or cleared storage shows every note.
            setHidden([]);
        }
    }, []);

    // Nothing until the hidden ones are known, so a hidden note never flashes up.
    if (hidden === null) return null;
    const shown = notes.filter((note) => !hidden.includes(note.id));
    if (shown.length === 0) return null;

    const hide = (id: string) => {
        // Only the notes still listed are kept, so the list never grows.
        const next = [...hidden.filter((entry) => notes.some((note) => note.id === entry)), id];
        setHidden(next);
        try {
            localStorage.setItem(HIDDEN_KEY, JSON.stringify(next));
        } catch {
            // Without storage the note shows again on the next visit.
        }
    };

    return (
        <div className="grid gap-2">
            {shown.map((note) => (
                <div key={note.id} role="status" className="flex gap-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm">
                    <Unlink className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                        <p className="font-medium">
                            {note.name} is no longer shared with this tenant <span className="font-normal text-muted-foreground">· <RelativeTime date={note.at} /></span>
                        </p>
                        <p className="text-muted-foreground">{lossOf(note)}</p>
                    </div>
                    <Button variant="ghost" className="size-7 shrink-0 p-0" aria-label={`Hide the note about ${note.name}`} onClick={() => hide(note.id)}>
                        <X className="size-4" />
                    </Button>
                </div>
            ))}
        </div>
    );
}
