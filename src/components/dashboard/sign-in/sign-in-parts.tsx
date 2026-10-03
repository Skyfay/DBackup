"use client";

import { CopyButton } from "@/components/dashboard/jobs/api-trigger-parts";
import { UserAvatar } from "@/components/dashboard/users/user-cells";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { ProviderTile } from "@/components/oidc/provider-logo";
import type { SsoPerson } from "@/services/sso/sso-providers-types";
import { adapterCopy, SSO_SCOPES } from "./sign-in-adapters";

/** Lines to copy in one frame, a line between them. */
export function CopyFrame({ children }: { children: React.ReactNode }) {
    return <div className="min-w-0 divide-y rounded-lg border">{children}</div>;
}

/** One line of a frame: what it is, the value, and Copy at the end, or a plain note without a copy. */
export function CopyLine({ label, value, note }: { label: string; value?: string; note?: string }) {
    return (
        <div className="flex min-w-0 items-center gap-3 py-1.5 pr-1.5 pl-3">
            <span className="w-24 shrink-0 text-xs text-muted-foreground">{label}</span>
            {value !== undefined ? (
                <>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs" title={value}>{value}</span>
                    <CopyButton value={value} label={label.toLowerCase()} />
                </>
            ) : (
                <span className="min-w-0 flex-1 truncate py-1.5 text-xs text-muted-foreground">{note}</span>
            )}
        </div>
    );
}

/** Someone with no password, no passkey and no other provider, whom switching this one off locks out. */
export function OnlyWayTag() {
    return (
        <span
            className="shrink-0 rounded-sm border border-warning/30 bg-warning/10 px-1.5 py-0.5 text-[11px] font-medium text-warning"
            title="No password, passkey or other provider that works. Without this provider they cannot sign in."
        >
            no other way in
        </span>
    );
}

/** A person linked through a provider, with when they last signed in through it. */
export function LinkedPersonRow({ person }: { person: SsoPerson }) {
    return (
        <li className="flex min-w-0 items-center gap-3 py-2">
            <UserAvatar user={person} />
            <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{person.name}</span>
                    {person.otherWays.length === 0 && <OnlyWayTag />}
                </div>
                <div className="truncate text-xs text-muted-foreground">{person.email}</div>
            </div>
            <span className="shrink-0 text-xs text-muted-foreground">
                {person.lastSignInAt ? <>signed in <RelativeTime date={person.lastSignInAt} /></> : "never signed in"}
            </span>
        </li>
    );
}

interface SetupBoxProps {
    adapterId: string;
    callbackUrl: string;
    /** Named when it is still being picked, since it becomes part of the URL for good. */
    providerId?: string;
}

/** What to set up on the side of the provider, in three steps, with the callback URL to copy. */
export function SetupBox({ adapterId, callbackUrl, providerId }: SetupBoxProps) {
    const copy = adapterCopy(adapterId);
    const place = adapterId === "generic" ? "the provider" : copy.name;
    return (
        <div className="min-w-0 space-y-3 rounded-lg border bg-muted/30 p-4">
            <div className="flex items-center gap-2.5">
                <ProviderTile adapterId={adapterId} size="sm" />
                <span className="text-sm font-medium">In {place}</span>
            </div>
            <ol className="space-y-2">
                {copy.setup.map((step, index) => (
                    <li key={step} className="flex gap-2.5 text-xs leading-relaxed">
                        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold tabular-nums" aria-hidden="true">
                            {index + 1}
                        </span>
                        <span className="min-w-0">{step}</span>
                    </li>
                ))}
            </ol>
            <div className="rounded-lg bg-card">
                <CopyFrame>
                    <CopyLine label="Callback URL" value={callbackUrl} />
                    <CopyLine label="Scopes" value={SSO_SCOPES} />
                </CopyFrame>
            </div>
            {providerId && (
                <p className="text-xs text-muted-foreground">
                    The last part, <span className="font-mono">{providerId}</span>, is the provider ID and stays once the provider is saved.
                </p>
            )}
        </div>
    );
}
