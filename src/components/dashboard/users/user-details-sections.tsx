"use client";

import Link from "next/link";
import { useState } from "react";
import { Download, Eye, Fingerprint, KeyRound, Loader2, LogIn, LogOut, Pencil, Play, Plus, Smartphone, Trash, TriangleAlert, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { revokeUserSession } from "@/app/actions/auth/user-security";
import { BrowserIcon, OsIcon } from "@/components/auth/device-icons";
import { Section } from "@/components/adapter/connection-details-sections";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { getOidcProviderIcon } from "@/components/oidc/provider-icon";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DateDisplay } from "@/components/utils/date-display";
import { accessSentences, summarizeAccess } from "@/lib/auth/access-summary";
import { AUDIT_ACTIONS } from "@/lib/core/audit-types";
import { describeAgent, formatIpAddress } from "@/lib/core/user-agent";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { cn } from "@/lib/utils";
import type { UserActivity, UserApiKey, UserDetails, UserRow, UsersGroup } from "@/services/user/users-types";

const log = logger.child({ component: "user-details" });

/** One line of a list in the panel: a tile, two lines of text and an action. */
function Line({ tile, title, fact, action }: { tile: React.ReactNode; title: React.ReactNode; fact?: React.ReactNode; action?: React.ReactNode }) {
    return (
        <li className="flex min-w-0 items-center gap-3 py-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted" aria-hidden="true">{tile}</span>
            <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2 text-sm font-medium">{title}</div>
                {fact && <div className="truncate text-xs text-muted-foreground">{fact}</div>}
            </div>
            {action && <div className="shrink-0">{action}</div>}
        </li>
    );
}

function Lines({ children }: { children: React.ReactNode }) {
    return <ul className="divide-y border-y">{children}</ul>;
}

function Quiet({ children }: { children: React.ReactNode }) {
    return <p className="text-sm text-muted-foreground">{children}</p>;
}

export function LinesSkeleton({ rows = 2 }: { rows?: number }) {
    return (
        <div className="space-y-2" aria-hidden="true">
            {Array.from({ length: rows }, (_, index) => <Skeleton key={index} className="h-10 w-full" />)}
        </div>
    );
}

/** What the group lets the user do, in words, or an amber note for a user without a group. */
export function AccessSection({ user, groups, onChangeGroup }: { user: UserRow; groups: UsersGroup[]; onChangeGroup?: () => void }) {
    const group = user.group ? groups.find((entry) => entry.id === user.group?.id) : undefined;
    const aside = onChangeGroup && (
        <button type="button" onClick={onChangeGroup} className="rounded-sm text-xs font-medium text-foreground outline-none hover:underline hover:underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring/50">
            Change group
        </button>
    );

    if (!user.group || !group) {
        return (
            <Section title="Access" aside={aside}>
                <div className="relative flex gap-3 overflow-hidden rounded-lg border border-warning/30 bg-warning/5 p-3 pl-4">
                    <span className="absolute inset-y-0 left-0 w-1 bg-warning" aria-hidden="true" />
                    <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
                    <div className="min-w-0 space-y-1 text-sm">
                        <p className="font-medium">No group</p>
                        <p className="text-muted-foreground">Signs in, but sees and does nothing until someone picks a group.</p>
                    </div>
                </div>
            </Section>
        );
    }

    const summary = summarizeAccess(group.permissions, group.superAdmin);
    return (
        <Section title="Access" aside={aside}>
            <p className="text-sm leading-relaxed">{accessSentences(summary).join(" ")}</p>
            <p className="text-xs text-muted-foreground">
                {summary.all ? `All ${summary.total} permissions` : `${summary.count} of ${summary.total} permissions`} of the group {group.name}
            </p>
        </Section>
    );
}

interface SignInProps {
    user: UserRow;
    details: UserDetails | null;
    onPassword?: () => void;
    onResetTwoFactor?: () => void;
}

/** Each way the user signs in, with what an admin can do about it. */
export function SignInSection({ user, details, onPassword, onResetTwoFactor }: SignInProps) {
    if (!details) {
        return (
            <Section title="Signs in with">
                <LinesSkeleton rows={2} />
            </Section>
        );
    }
    const passkeyFactor = user.secondFactor === "passkey";
    const passkeyNames = details.passkeys.map((passkey) => passkey.name || "Unnamed").join(", ");
    return (
        <Section title="Signs in with">
            <Lines>
                <Line
                    tile={<KeyRound className="size-4" />}
                    title="Password"
                    fact={details.password ? <>set <DateDisplay date={details.password.changedAt} format="P" /></> : "not set"}
                    action={onPassword && (
                        <Button variant="outline" size="sm" onClick={onPassword}>
                            {details.password ? "Set a new one" : "Set one"}
                        </Button>
                    )}
                />
                {details.app && (
                    <Line
                        tile={<Smartphone className="size-4" />}
                        title="Authenticator app"
                        fact="asks for a code after the password"
                        action={onResetTwoFactor && <Button variant="ghost-destructive" size="sm" onClick={onResetTwoFactor}>Reset 2FA</Button>}
                    />
                )}
                {details.passkeys.length > 0 && (
                    <Line
                        tile={<Fingerprint className="size-4" />}
                        title={details.passkeys.length === 1 ? "Passkey" : `${details.passkeys.length} passkeys`}
                        fact={passkeyFactor ? `${passkeyNames}, also the second factor` : passkeyNames}
                        action={passkeyFactor && onResetTwoFactor && <Button variant="ghost-destructive" size="sm" onClick={onResetTwoFactor}>Reset 2FA</Button>}
                    />
                )}
                {details.sso.map((link) => {
                    const Icon = getOidcProviderIcon(link.adapterId);
                    return (
                        <Line
                            key={link.providerId}
                            tile={<Icon className="size-4" />}
                            title={link.name}
                            fact={<>single sign-on, linked <DateDisplay date={link.linkedAt} format="P" /></>}
                        />
                    );
                })}
            </Lines>
        </Section>
    );
}

interface SessionsProps {
    user: UserRow;
    details: UserDetails | null;
    /** Absent without the right to change users. */
    onSignOutAll?: () => void;
    onChanged: () => void;
}

/** The browsers signed in as the user, each one to sign out on its own. */
export function SessionsSection({ user, details, onSignOutAll, onChanged }: SessionsProps) {
    const [ending, setEnding] = useState<string | null>(null);
    const others = details?.sessions.filter((session) => !session.current).length ?? 0;
    const aside = onSignOutAll && others > 0 && (
        <button type="button" onClick={onSignOutAll} className="rounded-sm text-xs font-medium text-destructive-text outline-none hover:underline hover:underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring/50">
            {user.isYou ? "Sign out other sessions" : "Sign out everywhere"}
        </button>
    );

    const end = async (sessionId: string) => {
        setEnding(sessionId);
        try {
            const result = await revokeUserSession(user.id, sessionId);
            if (result.success) {
                toast.success("Session ended");
                onChanged();
            } else {
                toast.error(result.error || "The session could not be ended.");
            }
        } catch (error) {
            log.warn("Ending a session failed", { userId: user.id }, wrapError(error));
            toast.error("The session could not be ended.");
        }
        setEnding(null);
    };

    return (
        <Section title="Sessions" aside={aside}>
            {!details ? (
                <LinesSkeleton rows={1} />
            ) : details.sessions.length === 0 ? (
                <Quiet>No browser is signed in as {user.isYou ? "you" : user.name}.</Quiet>
            ) : (
                <Lines>
                    {details.sessions.map((session) => (
                        <Line
                            key={session.id}
                            tile={<BrowserIcon browser={session.agent.browser} device={session.device} className="size-4" />}
                            title={
                                <>
                                    <span className="truncate">{describeAgent(session.agent) ?? "An unknown browser"}</span>
                                    <OsIcon os={session.agent.os} className="shrink-0" />
                                    {session.current && <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">This browser</span>}
                                </>
                            }
                            fact={<>{session.ip && `${formatIpAddress(session.ip)} · `}signed in <RelativeTime date={session.createdAt} /></>}
                            action={!session.current && onSignOutAll && (
                                <Button variant="ghost-destructive" size="sm" onClick={() => void end(session.id)} disabled={ending !== null}>
                                    {ending === session.id && <Loader2 className="animate-spin" />}
                                    Sign out
                                </Button>
                            )}
                        />
                    ))}
                </Lines>
            )}
        </Section>
    );
}

function keyState(key: UserApiKey, now: number): { text: string; warn: boolean } {
    if (!key.enabled) return { text: "disabled", warn: false };
    if (key.expiresAt && Date.parse(key.expiresAt) <= now) return { text: "expired", warn: true };
    return { text: "enabled", warn: false };
}

/** The API keys the user owns, which act with their own permissions. */
export function ApiKeysSection({ user, details }: { user: UserRow; details: UserDetails | null }) {
    const [now] = useState(() => Date.now());
    return (
        <Section title="API keys" aside={details && details.apiKeys.length > 0 ? <Link href="?tab=apikeys" className="hover:underline hover:underline-offset-4">All API keys</Link> : undefined}>
            {!details ? (
                <LinesSkeleton rows={1} />
            ) : details.apiKeys.length === 0 ? (
                <Quiet>{user.isYou ? "You own" : `${user.name} owns`} no API key.</Quiet>
            ) : (
                <Lines>
                    {details.apiKeys.map((key) => {
                        const state = keyState(key, now);
                        return (
                            <Line
                                key={key.id}
                                tile={<KeyRound className="size-4" />}
                                title={
                                    <>
                                        <span className="truncate">{key.name}</span>
                                        <span className={cn("shrink-0 text-xs font-normal", state.warn ? "text-warning" : "text-muted-foreground")}>{state.text}</span>
                                    </>
                                }
                                fact={
                                    <>
                                        <span className="font-mono">{key.prefix}...</span>
                                        {" · "}
                                        {key.lastUsedAt ? <>used <RelativeTime date={key.lastUsedAt} /></> : "never used"}
                                    </>
                                }
                            />
                        );
                    })}
                </Lines>
            )}
        </Section>
    );
}

const ACTIVITY_ICONS: Record<string, LucideIcon> = {
    [AUDIT_ACTIONS.LOGIN]: LogIn,
    [AUDIT_ACTIONS.LOGOUT]: LogOut,
    [AUDIT_ACTIONS.CREATE]: Plus,
    [AUDIT_ACTIONS.UPDATE]: Pencil,
    [AUDIT_ACTIONS.DELETE]: Trash,
    [AUDIT_ACTIONS.EXECUTE]: Play,
    [AUDIT_ACTIONS.EXPORT]: Download,
};

/** The newest entries of the audit log the user wrote. */
export function ActivitySection({ details }: { details: UserDetails | null }) {
    return (
        <Section
            title="Activity"
            aside={details ? <Link href="?tab=audit" className="hover:underline hover:underline-offset-4">All in the audit log</Link> : undefined}
        >
            {!details ? (
                <LinesSkeleton rows={3} />
            ) : details.activity.length === 0 ? (
                <Quiet>Nothing in the audit log of the last {details.auditDays} days.</Quiet>
            ) : (
                <ul className="space-y-0.5">
                    {details.activity.map((entry: UserActivity) => {
                        const Icon = ACTIVITY_ICONS[entry.action] ?? Eye;
                        return (
                            <li key={entry.id} className="flex min-w-0 items-center gap-2.5 py-1.5 text-sm">
                                <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                                <span className="min-w-0 flex-1 truncate" title={entry.text}>{entry.text}</span>
                                <RelativeTime date={entry.at} className="shrink-0 text-xs text-muted-foreground" />
                            </li>
                        );
                    })}
                </ul>
            )}
        </Section>
    );
}
