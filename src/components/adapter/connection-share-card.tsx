"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Globe, Lock, MoreHorizontal, Share2, Trash2, Unlink } from "lucide-react";
import { toast } from "sonner";
import { getConnectionShare } from "@/app/actions/tenant/connection-share";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { useCan } from "@/components/permissions/permissions-context";
import { useTenantView } from "@/components/tenant/tenant-view";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { SEE_SHARING_PERMISSION, SHARE_PERMISSION } from "@/lib/tenant/sharing";
import { formatBytes } from "@/lib/utils";
import type { ConnectionShareView, ShareTenantUse } from "@/services/sharing/connection-shares";
import type { ConnectionKind } from "./connection-columns";
import { Section } from "./connection-details-sections";
import { TenantNameChip } from "./connection-sharing-cells";
import { ConnectionShareDialog, DeleteTenantBackupsDialog, StopSharingDialog } from "./connection-share-dialog";
import type { AdapterConfig } from "./types";

/**
 * Who sees what is shared, and who changes it: whoever holds the rights of the platform for it, in
 * a tenant that shares with customers while there is another tenant. Never in All tenants, where a
 * change opens the connection in its tenant first.
 */
export function useShareAccess(): { see: boolean; share: boolean } {
    const { tenants, activeTenantId, allTenants, tenantCount } = useTenantView();
    const sees = useCan(SEE_SHARING_PERMISSION);
    const shares = useCan(SHARE_PERMISSION);
    const tenant = tenants.find((entry) => entry.id === activeTenantId);
    const possible = !allTenants && Boolean(tenant?.sharesWithCustomers) && (tenantCount ?? tenants.length) > 1;
    return { see: possible && (sees || shares), share: possible && shares };
}

/** Whether a kind of connection can be shared at all: a destination or a channel. */
export const shareableKind = (kind: ConnectionKind) => kind === "destination" || kind === "notification";

const plural = (count: number, one: string, many: string) => `${count.toLocaleString()} ${count === 1 ? one : many}`;

/**
 * Why the viewer may not change who gets a connection at all, null when they may: it is shared with
 * every tenant, and their platform group does not reach every tenant.
 */
export const shareLock = (view: ConnectionShareView): string | null => (view.settings.allTenants ? view.reach.allTenants : null);

/** What the viewer may do at the line of one tenant: stop sharing with it, and delete its backups on a destination. */
function rightsAt(view: ConnectionShareView, use: ShareTenantUse, canShare: boolean) {
    const reached = canShare && !view.reach.outside.some((tenant) => tenant.id === use.tenantId);
    return { stop: reached && !shareLock(view), deleteBackups: reached };
}

function UseRow({ view, use, kind, canShare, onStop, onDelete }: { view: ConnectionShareView; use: ShareTenantUse; kind: ConnectionKind; canShare: boolean; onStop: () => void; onDelete: () => void }) {
    const destination = kind === "destination";
    const rights = rightsAt(view, use, canShare);
    return (
        <li className="flex min-w-0 items-center gap-3 py-2.5">
            <div className="min-w-0 flex-1">
                <TenantNameChip name={use.name} />
                <p className="mt-1 text-xs text-muted-foreground">
                    {plural(use.jobs, "job", "jobs")}
                    {destination
                        ? <> · {use.backups === null ? "not measured yet" : plural(use.backups, "backup", "backups")}{use.lastBackup && <> · last <RelativeTime date={use.lastBackup} /></>}</>
                        : <> · {plural(use.templates, "template", "templates")}</>}
                    {destination && view.settings.encryptedOnly && use.jobsWithoutKey > 0 && <span className="text-warning"> · {plural(use.jobsWithoutKey, "job without a key", "jobs without a key")}</span>}
                </p>
            </div>
            {destination && <span className="shrink-0 text-sm font-medium tabular-nums">{use.size === null ? "-" : formatBytes(use.size, 1)}</span>}
            {(rights.stop || (destination && rights.deleteBackups)) && (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="size-8 shrink-0 p-0" aria-label={`What to do with ${use.name}`}>
                            <MoreHorizontal className="size-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        {destination && rights.deleteBackups && (
                            <DropdownMenuItem tone="destructive" onSelect={onDelete}>
                                <Trash2 />
                                Delete its backups here
                            </DropdownMenuItem>
                        )}
                        {rights.stop && (
                            <DropdownMenuItem tone={destination ? "destructive" : "warning"} onSelect={onStop}>
                                <Unlink />
                                Stop sharing with {use.name}
                            </DropdownMenuItem>
                        )}
                    </DropdownMenuContent>
                </DropdownMenu>
            )}
        </li>
    );
}

/** How the space of a shared destination splits between its own tenant and its customers. */
function SpaceBar({ view }: { view: ConnectionShareView }) {
    const own = view.own?.size ?? 0;
    const theirs = view.uses.reduce((sum, use) => sum + (use.size ?? 0), 0);
    const total = own + theirs;
    if (total === 0) return null;
    return (
        <div className="space-y-1.5">
            <div className="flex h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                <span className="bg-foreground/70" style={{ width: `${(own / total) * 100}%` }} />
                <span className="bg-foreground/30" style={{ width: `${(theirs / total) * 100}%` }} />
            </div>
            <p className="flex justify-between gap-3 text-xs text-muted-foreground tabular-nums">
                <span>{formatBytes(own, 1)} of this tenant</span>
                <span>{formatBytes(theirs, 1)} of {plural(view.uses.length, "tenant", "tenants")}</span>
            </p>
        </div>
    );
}

/** Loads who gets a connection and opens its sharing, for the menu of a row. */
export function ShareDialogLoader({ configId, onClose, onSaved }: { configId: string; onClose: () => void; onSaved: () => void }) {
    const [view, setView] = useState<ConnectionShareView | null>(null);
    // The list around it renders on every poll, so the latest close is kept apart from the load.
    const close = useRef(onClose);
    useEffect(() => {
        close.current = onClose;
    }, [onClose]);
    useEffect(() => {
        let ignore = false;
        getConnectionShare(configId)
            .then((result) => {
                if (ignore) return;
                // A share with every tenant changes only with a reach of every tenant.
                const refusal = result.success ? shareLock(result.data) : result.error;
                if (result.success && !refusal) setView(result.data);
                else {
                    toast.error(refusal);
                    close.current();
                }
            })
            .catch(() => {
                if (!ignore) close.current();
            });
        return () => {
            ignore = true;
        };
    }, [configId]);
    if (!view) return null;
    return <ConnectionShareDialog view={view} onOpenChange={(open) => !open && onClose()} onSaved={onSaved} />;
}

/**
 * The card Shared with tenants in the details of an own destination or channel: who gets it, on
 * what terms, and how each tenant uses it, never its backups. Change opens the sharing, a row the
 * stop for that tenant, and on a destination the delete of its backups there.
 */
export function ConnectionShareCard({ config, kind, onChanged }: { config: AdapterConfig; kind: ConnectionKind; onChanged?: () => void }) {
    const access = useShareAccess();
    const visible = shareableKind(kind) && !config.provided && access.see;
    const [view, setView] = useState<ConnectionShareView | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [editing, setEditing] = useState(false);
    const [stopping, setStopping] = useState<ShareTenantUse | null>(null);
    const [deleting, setDeleting] = useState<ShareTenantUse | null>(null);

    const load = useCallback(() => {
        getConnectionShare(config.id)
            .then((result) => {
                if (result.success) {
                    setView(result.data);
                    setError(null);
                } else setError(result.error);
            })
            .catch(() => setError("The sharing of this connection could not be read."));
    }, [config.id]);

    useEffect(() => {
        if (visible) load();
    }, [visible, load]);

    if (!visible) return null;
    const changed = () => {
        load();
        onChanged?.();
    };

    const terms = view && [
        ...(view.kind === "destination" && view.settings.encryptedOnly ? ["Only encrypted backups"] : []),
        ...(view.email && view.shared ? [view.settings.ownRecipients ? "Each tenant picks its recipients" : "Sends to the recipients set here"] : []),
    ];

    return (
        <Section
            title="Shared with tenants"
            aside={access.share && view && !shareLock(view) ? (
                <Button variant="outline" size="sm" tone="edit" onClick={() => setEditing(true)}>
                    <Share2 />
                    Change
                </Button>
            ) : undefined}
        >
            {error ? (
                <p className="text-sm text-destructive">{error}</p>
            ) : !view ? (
                <Skeleton className="h-16 w-full" />
            ) : (
                <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg bg-muted/50 px-3 py-2.5">
                        {view.settings.allTenants ? <Globe className="size-4 text-muted-foreground" aria-hidden="true" /> : <Share2 className="size-4 text-muted-foreground" aria-hidden="true" />}
                        <span className="min-w-0 flex-1 text-sm">
                            {view.settings.allTenants
                                ? "All tenants, new ones too"
                                : view.uses.length > 0 ? `${plural(view.uses.length, "tenant", "tenants")}` : "Only this tenant"}
                        </span>
                        {terms?.map((term) => (
                            <span key={term} className="inline-flex items-center gap-1 rounded-md bg-background px-2 py-0.5 text-xs font-medium">
                                {term === "Only encrypted backups" && <Lock className="size-3 text-muted-foreground" aria-hidden="true" />}
                                {term}
                            </span>
                        ))}
                    </div>
                    {view.kind === "destination" && <SpaceBar view={view} />}
                    {view.uses.length > 0 && (
                        <ul className="divide-y">
                            {view.uses.map((use) => (
                                <UseRow key={use.tenantId} view={view} use={use} kind={kind} canShare={access.share} onStop={() => setStopping(use)} onDelete={() => setDeleting(use)} />
                            ))}
                        </ul>
                    )}
                    {access.share && shareLock(view) && <p className="text-xs text-muted-foreground">{shareLock(view)}</p>}
                    <p className="text-xs text-muted-foreground">
                        {view.kind === "destination"
                            ? "You see the space a tenant takes, never its backups. A tenant writes to tenants/ and its id here, your own backups stay where they are."
                            : "A tenant names it in its notification templates. Its address and login stay with this tenant."}
                    </p>
                </div>
            )}

            {view && editing && <ConnectionShareDialog view={view} onOpenChange={setEditing} onSaved={changed} />}
            {view && stopping && (
                <StopSharingDialog view={view} use={stopping} onOpenChange={(open) => !open && setStopping(null)} onDone={changed} />
            )}
            {view && deleting && (
                <DeleteTenantBackupsDialog
                    view={view}
                    use={deleting}
                    onOpenChange={(open) => !open && setDeleting(null)}
                    onDone={() => {
                        toast.success(`The backups of ${deleting.name} are being removed from the numbers.`);
                        changed();
                    }}
                />
            )}
        </Section>
    );
}
