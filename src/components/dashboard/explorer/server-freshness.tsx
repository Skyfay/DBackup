"use client";

import { useState } from "react";
import { Check, ClockAlert, Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { count } from "@/components/dashboard/storage/explorer/explorer-format";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { Button } from "@/components/ui/button";
import { DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { ExplorerServer } from "@/services/databases/database-explorer-types";
import { freshnessOf } from "./database-model";

interface ServerFreshnessProps {
    servers: ExplorerServer[];
    /** Reads the databases of every server from the servers now. */
    onReadNow: () => Promise<void>;
}

/**
 * How old the lists of databases are. DBackup reads them from every server once an hour, beside
 * the version, and Read now reads them at once. A server whose read failed keeps its last list.
 */
export function ServerFreshness({ servers, onReadNow }: ServerFreshnessProps) {
    const [open, setOpen] = useState(false);
    const [reading, setReading] = useState(false);
    const { behind, oldest } = freshnessOf(servers);
    if (servers.length === 0) return null;

    const read = async () => {
        setReading(true);
        try {
            await onReadNow();
        } finally {
            setReading(false);
        }
    };

    const tone = behind.length > 0 ? "warning" : "success";
    const label = reading
        ? "Reading"
        : behind.length > 0 && servers.length > 1
            ? `${servers.length - behind.length} of ${servers.length} read`
            : oldest ? <>Read <RelativeTime date={oldest} /></> : "Not read yet";

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button variant="outline" className="h-9 gap-2 px-3" aria-label="How old the lists of databases are">
                    {reading ? <Loader2 className="animate-spin" /> : <RefreshCw className="text-muted-foreground" />}
                    <span className="hidden sm:inline">{label}</span>
                    {!reading && behind.length > 0 && <span className="size-1.5 rounded-full bg-warning" aria-hidden="true" />}
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-96 overflow-hidden p-0" align="end">
                <DialogHead tone={tone} icon={behind.length > 0 ? TriangleAlert : Check} className="px-4 py-3">
                    <p className="text-sm font-semibold">{behind.length > 0 ? `${count(behind.length, "server")} not read` : "The lists are up to date"}</p>
                    <p className={cn(dialogNoteClass(tone), "truncate")}>
                        {behind.length > 0 ? "Their databases show as they were at the last read" : "Read from every server once an hour"}
                    </p>
                </DialogHead>
                <div className="space-y-3 px-4 py-3">
                    <p className="text-xs leading-relaxed text-muted-foreground">
                        DBackup reads the databases of every server with their sizes once an hour, when it checks the version. Tables and rows are read live when you open them.
                    </p>
                    <ScrollArea className="*:data-[slot=scroll-area-viewport]:max-h-[min(24rem,50vh)]">
                        <ul className="divide-y overflow-hidden rounded-lg border">
                            {servers.map((server) => {
                                const failed = server.readError !== null || !server.readAt;
                                return (
                                    <li key={server.id} className="flex items-center gap-3 px-3 py-2" title={server.readError ?? undefined}>
                                        <AdapterIcon adapterId={server.adapterId} className="size-4 shrink-0" />
                                        <div className="min-w-0 flex-1">
                                            <span className="block truncate text-sm font-medium">{server.name}</span>
                                            <span className={cn("block truncate text-xs", failed ? "text-warning" : "text-muted-foreground")}>
                                                {server.readError ? `The last read failed: ${server.readError}` : server.readAt ? <>Read <RelativeTime date={server.readAt} /></> : "Not read yet"}
                                            </span>
                                        </div>
                                        {failed ? <ClockAlert className="size-4 shrink-0 text-warning" aria-hidden="true" /> : <Check className="size-4 shrink-0 text-success" aria-hidden="true" />}
                                    </li>
                                );
                            })}
                        </ul>
                    </ScrollArea>
                </div>
                <div className="flex items-center justify-end border-t bg-page/60 px-4 py-2.5">
                    <Button variant="outline" size="sm" onClick={() => void read()} disabled={reading}>
                        {reading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                        Read now
                    </Button>
                </div>
            </PopoverContent>
        </Popover>
    );
}
