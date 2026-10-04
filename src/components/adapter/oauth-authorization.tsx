"use client";

import { useEffect, useState } from "react";
import { CircleCheck, ExternalLink, KeyRound, Link2, Loader2, TriangleAlert, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Provider {
    /** The drive, as the user knows it. */
    name: string;
    /** Whose sign-in page opens. */
    account: string;
    /** The segment of its routes under `/api/adapters/`. */
    slug: string;
}

const PROVIDERS: Record<string, Provider> = {
    "google-drive": { name: "Google Drive", account: "Google", slug: "google-drive" },
    dropbox: { name: "Dropbox", account: "Dropbox", slug: "dropbox" },
    onedrive: { name: "OneDrive", account: "Microsoft", slug: "onedrive" },
};

type BoxTone = "neutral" | "success" | "warning";

const TONES: Record<BoxTone, { box: string; tile: string }> = {
    neutral: { box: "bg-muted/30", tile: "bg-muted text-muted-foreground" },
    success: { box: "", tile: "bg-success/12 text-success" },
    warning: { box: "border-warning/30 bg-warning/5", tile: "bg-warning/12 text-warning" },
};

function StatusBox({ tone, icon: Icon, spin, title, text, action }: {
    tone: BoxTone;
    icon: LucideIcon;
    spin?: boolean;
    title: string;
    text: string;
    action?: React.ReactNode;
}) {
    return (
        <div className={cn("flex flex-wrap items-center gap-3 rounded-lg border p-3", TONES[tone].box)}>
            <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", TONES[tone].tile)} aria-hidden="true">
                <Icon className={cn("size-4", spin && "animate-spin")} />
            </span>
            <div className="grid min-w-0 flex-1 gap-0.5">
                <p className="text-sm font-medium">{title}</p>
                <p className="text-xs text-muted-foreground">{text}</p>
            </div>
            {action}
        </div>
    );
}

interface OAuthAuthorizationProps {
    adapterId: string;
    /** The OAuth credential profile to authorize. */
    credentialId?: string;
    /** Whether the profile already holds a refresh token. */
    authorized: boolean;
    /** Called once the sign-in window reports success, so the profile can be loaded again. */
    onAuthorized?: () => void;
}

/**
 * Lets DBackup into a cloud drive.
 *
 * The token is stored on the OAuth profile rather than on the connection, so this works
 * before the connection is saved. A stored token is checked against the provider, because
 * one the user revoked there still looks authorized here.
 */
export function OAuthAuthorization({ adapterId, credentialId, authorized, onAuthorized }: OAuthAuthorizationProps) {
    const provider = PROVIDERS[adapterId];
    const [starting, setStarting] = useState(false);
    // A new sign-in counts as a new token, which needs checking again.
    const [round, setRound] = useState(0);
    const [check, setCheck] = useState<{ key: string; result: "valid" | "expired" } | null>(null);
    const checkKey = `${credentialId}|${round}`;
    const tokenState = !authorized || !credentialId ? null : check?.key === checkKey ? check.result : "checking";

    useEffect(() => {
        if (!provider || !authorized || !credentialId) return;
        let active = true;
        fetch(`/api/adapters/${provider.slug}/validate-token`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ credentialId }),
        })
            .then((res) => res.json())
            .then((data) => { if (active) setCheck({ key: `${credentialId}|${round}`, result: data.valid ? "valid" : "expired" }); })
            // A check that cannot run says nothing about the token, so it counts as valid.
            .catch(() => { if (active) setCheck({ key: `${credentialId}|${round}`, result: "valid" }); });
        return () => { active = false; };
    }, [provider, authorized, credentialId, round]);

    if (!provider) return null;

    const authorize = async () => {
        setStarting(true);
        try {
            const res = await fetch(`/api/adapters/${provider.slug}/auth`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ credentialId }),
            });
            const data = await res.json();
            if (!data.success || !data.data?.authUrl) {
                toast.error(data.error || "Failed to start authorization");
                setStarting(false);
                return;
            }

            const popup = window.open(data.data.authUrl, "dbackup_oauth", "width=600,height=700,scrollbars=yes,resizable=yes");
            if (!popup) {
                // A blocked popup falls back to leaving the page. The callback brings the user back.
                window.location.href = data.data.authUrl;
                return;
            }

            const onMessage = (event: MessageEvent) => {
                if (event.origin !== window.location.origin || event.data?.type !== "oauth_complete") return;
                window.removeEventListener("message", onMessage);
                clearInterval(closedPoll);
                setStarting(false);
                if (event.data.status === "success") {
                    toast.success(event.data.message);
                    setRound((current) => current + 1);
                    onAuthorized?.();
                } else {
                    toast.error(event.data.message);
                }
            };
            window.addEventListener("message", onMessage);

            // A window closed without finishing sends no message.
            const closedPoll = setInterval(() => {
                if (!popup.closed) return;
                clearInterval(closedPoll);
                window.removeEventListener("message", onMessage);
                setStarting(false);
            }, 500);
        } catch {
            toast.error(`Failed to start the ${provider.account} authorization`);
            setStarting(false);
        }
    };

    const button = (label: string) => (
        <Button type="button" variant="outline" size="sm" onClick={authorize} disabled={starting}>
            {starting ? <Loader2 className="animate-spin" /> : <ExternalLink />}
            {label}
        </Button>
    );

    if (!credentialId) {
        return <StatusBox tone="neutral" icon={KeyRound} title="No OAuth app picked yet" text={`Pick or create the app above, then let it into ${provider.name}.`} />;
    }
    if (tokenState === "checking") {
        return <StatusBox tone="neutral" icon={Loader2} spin title="Checking the authorization" text={`Asking ${provider.account} whether the stored token still works.`} />;
    }
    if (tokenState === "expired") {
        return (
            <StatusBox
                tone="warning"
                icon={TriangleAlert}
                title="The authorization has expired"
                text={`Authorize again to let DBackup back into ${provider.name}.`}
                action={button("Authorize again")}
            />
        );
    }
    if (authorized) {
        return <StatusBox tone="success" icon={CircleCheck} title="Authorized" text={`DBackup can reach ${provider.name} with this app.`} action={button("Authorize again")} />;
    }
    return (
        <StatusBox
            tone="neutral"
            icon={Link2}
            title="Not authorized yet"
            text={`${provider.account} opens in a new window to grant access.`}
            action={button("Authorize")}
        />
    );
}
