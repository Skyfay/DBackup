"use client";

import { useEffect, useId, useState } from "react";
import { ArrowRightLeft, Database, Info, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getMoveTargets, moveSharedDatabase } from "@/app/actions/tenant/database-assignments";
import { Button } from "@/components/ui/button";
import { DIALOG_FOOTER, DIALOG_SURFACE, DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { cn } from "@/lib/utils";
import type { DatabaseOwnerRow } from "@/services/tenant/database-assignments";
import type { MoveTarget } from "@/services/tenant/database-moves";

const log = logger.child({ component: "assignment-move-dialog" });

/** How many databases of the new server the dialog offers to pick a name from. */
const NAMES_SHOWN = 12;

interface MoveDialogProps {
    serverId: string;
    serverName: string;
    /** A database a tenant holds now. */
    row: DatabaseOwnerRow & { owner: NonNullable<DatabaseOwnerRow["owner"]> };
    onClose: () => void;
    onMoved: () => void;
}

/**
 * Marks a database a tenant holds as moved to another server of the same engine, in the violet of
 * an edit: the server and the name it has there, and what the tenant keeps. Its backups of this
 * server stay with the tenant and restore into the database at its new place.
 */
export function MoveDialog({ serverId, serverName, row, onClose, onMoved }: MoveDialogProps) {
    const ids = { server: useId(), name: useId() };
    const [targets, setTargets] = useState<MoveTarget[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [targetId, setTargetId] = useState<string>("");
    const [name, setName] = useState(row.name);
    const [pending, setPending] = useState(false);
    const tenant = row.owner.tenantName;

    useEffect(() => {
        let ignore = false;
        getMoveTargets(serverId)
            .then((result) => {
                if (ignore) return;
                if (!result.success) return setError(result.error);
                setTargets(result.data);
                if (result.data.length === 1) setTargetId(result.data[0].id);
            })
            .catch((failure: unknown) => {
                if (ignore) return;
                log.warn("Loading the servers to move to failed", { serverId }, wrapError(failure));
                setError("The servers could not be loaded.");
            });
        return () => {
            ignore = true;
        };
    }, [serverId]);

    const target = targets?.find((entry) => entry.id === targetId) ?? null;
    const clean = name.trim();
    const listed = target ? target.databases.includes(clean) : false;
    const ready = target !== null && clean.length > 0;

    const move = async () => {
        if (!target || !ready) return;
        setPending(true);
        try {
            const result = await moveSharedDatabase(serverId, { databaseName: row.name, toSourceId: target.id, toDatabase: clean });
            if (!result.success) {
                setError(result.error);
                return;
            }
            toast.success(`${row.name} moved to ${result.data.toServerName}`, { description: `${result.data.tenantName} keeps its backups and restores them into ${result.data.toDatabase} there.` });
            onMoved();
        } catch (failure: unknown) {
            log.warn("Moving a database failed", { serverId }, wrapError(failure));
            setError("The database could not be moved.");
        } finally {
            setPending(false);
        }
    };

    return (
        <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
            <DialogContent tone="edit" showCloseButton={false} className={cn(DIALOG_SURFACE, "sm:max-w-xl")}>
                <DialogHead tone="edit" icon={ArrowRightLeft}>
                    <DialogTitle className="text-base">Move {row.name} to another server</DialogTitle>
                    <DialogDescription className={dialogNoteClass("edit")}>{serverName} · {tenant} holds it</DialogDescription>
                </DialogHead>

                <ScrollArea className="*:data-[slot=scroll-area-viewport]:max-h-[calc(95dvh-9.5rem)]">
                    <div className="space-y-4 p-5">
                        {targets === null && !error ? (
                            <div className="space-y-2" aria-busy="true">
                                <Skeleton className="h-4 w-24" />
                                <Skeleton className="h-9 w-full" />
                            </div>
                        ) : targets && targets.length === 0 ? (
                            <p className="rounded-lg border bg-muted/30 px-3 py-2.5 text-sm text-muted-foreground">
                                There is no other server of the same engine to move {row.name} to. Add the new server as a connection first.
                            </p>
                        ) : targets ? (
                            <>
                                <div className="space-y-1.5">
                                    <Label htmlFor={ids.server}>New server</Label>
                                    <Select value={targetId} onValueChange={(value) => { setTargetId(value); setError(null); }} disabled={pending}>
                                        <SelectTrigger id={ids.server} className="w-full">
                                            <SelectValue placeholder="Pick a server" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {targets.map((entry) => <SelectItem key={entry.id} value={entry.id}>{entry.name}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1.5">
                                    <Label htmlFor={ids.name}>Name there</Label>
                                    <Input id={ids.name} value={name} maxLength={200} autoComplete="off" disabled={pending} onChange={(event) => { setName(event.target.value); setError(null); }} />
                                    {target && (
                                        <p className="text-xs text-muted-foreground">
                                            {listed ? `${target.name} holds ${clean}.` : `${target.name} does not list ${clean || "it"} yet, the move counts all the same.`}
                                        </p>
                                    )}
                                    {target && target.databases.length > 0 && (
                                        <div className="flex flex-wrap gap-1.5 pt-1" aria-label={`Databases of ${target.name}`}>
                                            {target.databases.slice(0, NAMES_SHOWN).map((entry) => (
                                                <Button key={entry} type="button" variant="outline" size="sm" className={cn("h-7 px-2 text-xs", entry === clean && "border-tone/60 bg-tone/5")} onClick={() => setName(entry)} disabled={pending}>
                                                    <Database />
                                                    {entry}
                                                </Button>
                                            ))}
                                            {target.databases.length > NAMES_SHOWN && <span className="self-center text-xs text-muted-foreground">+{target.databases.length - NAMES_SHOWN} more</span>}
                                        </div>
                                    )}
                                </div>
                            </>
                        ) : null}

                        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}

                        <p className="flex gap-2.5 rounded-lg border bg-muted/30 px-3 py-2.5 text-sm text-muted-foreground">
                            <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                            <span>
                                {tenant} keeps one database: its backups of {serverName} stay and restore into {clean || row.name} on {target?.name ?? "the new server"}, and the backups there count from now on. On {serverName} no rule gives {row.name} to anyone from now on.
                            </span>
                        </p>
                    </div>
                </ScrollArea>

                <div className={cn(DIALOG_FOOTER, "flex justify-end gap-2")}>
                    <Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
                    <Button onClick={() => void move()} disabled={!ready || pending}>
                        {pending ? <Loader2 className="animate-spin" /> : <ArrowRightLeft />}
                        Move {row.name}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
