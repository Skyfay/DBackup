"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, LogOut } from "lucide-react";
import { toast } from "sonner";
import { BrowserIcon, OsIcon } from "@/components/auth/device-icons";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { PartFrame } from "@/components/dashboard/settings/settings-frame";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { authClient } from "@/lib/auth/client";
import { formatIpAddress, parseUserAgent } from "@/lib/core/user-agent";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";

const log = logger.child({ component: "sessions-part" });

interface SessionRow {
    id: string;
    token: string;
    createdAt: Date | string;
    updatedAt: Date | string;
    ipAddress?: string | null;
    userAgent?: string | null;
}

/** Every browser signed in as the viewer, this one first, each to sign out on its own. */
export function SessionsPart() {
    const { data: current } = authClient.useSession();
    const [sessions, setSessions] = useState<SessionRow[] | null>(null);
    const [ending, setEnding] = useState<string | null>(null);
    const [askingAll, setAskingAll] = useState(false);
    const [endingAll, setEndingAll] = useState(false);

    const load = useCallback(async () => {
        try {
            const result = await authClient.listSessions();
            setSessions((result.data ?? []) as SessionRow[]);
        } catch (error) {
            log.warn("Loading the sessions failed", {}, wrapError(error));
            setSessions([]);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const token = current?.session?.token;
    const rows = [...(sessions ?? [])].sort((a, b) => Number(b.token === token) - Number(a.token === token) || Date.parse(String(b.updatedAt)) - Date.parse(String(a.updatedAt)));
    const others = rows.filter((row) => row.token !== token).length;

    const end = async (row: SessionRow) => {
        setEnding(row.id);
        try {
            await authClient.revokeSession({ token: row.token });
            setSessions((list) => (list ?? []).filter((session) => session.id !== row.id));
            toast.success("Signed out");
        } catch (error) {
            log.warn("Signing out a session failed", {}, wrapError(error));
            toast.error("That browser could not be signed out.");
        } finally {
            setEnding(null);
        }
    };

    const endOthers = async () => {
        setEndingAll(true);
        try {
            await authClient.revokeOtherSessions();
            await load();
            toast.success("Every other browser is signed out");
        } catch (error) {
            log.warn("Signing out the other sessions failed", {}, wrapError(error));
            toast.error("The other browsers could not be signed out.");
        } finally {
            setEndingAll(false);
            setAskingAll(false);
        }
    };

    return (
        <PartFrame
            part="sessions"
            flush
            action={others > 0 && (
                <Button type="button" variant="outline" size="sm" onClick={() => setAskingAll(true)}>
                    <LogOut />
                    Sign out the others
                </Button>
            )}
        >
            <div className="p-4 md:p-6">
                {sessions === null ? (
                    <div className="space-y-2">
                        <Skeleton className="h-14 w-full" />
                        <Skeleton className="h-14 w-full" />
                    </div>
                ) : (
                    <ul className="divide-y overflow-hidden rounded-lg border">
                        {rows.map((row) => {
                            const { browser, os, device } = parseUserAgent(row.userAgent);
                            const here = row.token === token;
                            const address = formatIpAddress(row.ipAddress);
                            return (
                                <li key={row.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted/50" aria-hidden="true">
                                        <BrowserIcon browser={browser} device={device} className="size-4.5" />
                                    </span>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="text-sm font-medium">{browser}</span>
                                            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                                <OsIcon os={os} />
                                                {os}
                                            </span>
                                            {here && <Badge variant="outline" className="border-success/30 bg-success/10 text-success">This browser</Badge>}
                                        </div>
                                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                            {address && `${address} · `}signed in <RelativeTime date={String(row.createdAt)} /> · active <RelativeTime date={String(row.updatedAt)} />
                                        </p>
                                    </div>
                                    {!here && (
                                        <Button type="button" variant="ghost-destructive" size="sm" disabled={ending === row.id} onClick={() => void end(row)}>
                                            {ending === row.id ? <Loader2 className="animate-spin" /> : <LogOut />}
                                            Sign out
                                        </Button>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                )}
                <p className="mt-3 text-xs text-muted-foreground">A browser you do not know? Sign it out, then change your password under Security.</p>
            </div>

            <ConfirmDialog
                open={askingAll}
                onOpenChange={setAskingAll}
                icon={LogOut}
                destructive
                title="Sign out every other browser?"
                note="This browser stays signed in"
                description={`${others === 1 ? "1 other browser has" : `${others} other browsers have`} to sign in again.`}
                confirmLabel="Sign out the others"
                isPending={endingAll}
                onConfirm={() => void endOthers()}
            />
        </PartFrame>
    );
}
