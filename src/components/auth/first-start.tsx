"use client";

import { useState } from "react";
import { ArrowRight, RotateCcw, ServerCog, UserPlus, type LucideIcon } from "lucide-react";
import { toneAttribute, type Tone } from "@/components/ui/tone";
import { cn } from "@/lib/utils";
import { FirstAccountForm } from "./first-account-form";
import { LoginHeading } from "./login-parts";
import { SetupRestore } from "./setup-restore";

interface WayProps {
    icon: LucideIcon;
    tone: Tone;
    title: string;
    text: string;
    onClick: () => void;
    disabled?: boolean;
}

function Way({ icon: Icon, tone, title, text, onClick, disabled }: WayProps) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            {...toneAttribute(tone)}
            className="group flex w-full items-center gap-3.5 rounded-xl border bg-card p-3.5 text-left outline-none transition-colors hover:border-tone/50 hover:bg-tone/5 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-border disabled:hover:bg-card"
        >
            <span className="flex size-10.5 shrink-0 items-center justify-center rounded-lg border border-tone/25 bg-tone/12 text-tone" aria-hidden="true">
                <Icon className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{title}</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{text}</span>
            </span>
            <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-tone group-disabled:group-hover:text-muted-foreground" aria-hidden="true" />
        </button>
    );
}

/** A way that comes later, shown without a way in. */
function SoonWay() {
    return (
        <div className="flex w-full items-center gap-3.5 rounded-xl border bg-card/60 p-3.5">
            <span className="flex size-10.5 shrink-0 items-center justify-center rounded-lg border bg-muted text-muted-foreground" aria-hidden="true">
                <ServerCog className="size-5" />
            </span>
            <span className={cn("min-w-0 flex-1 opacity-75")}>
                <span className="flex items-center gap-2 text-sm font-semibold">
                    Use it as a runner
                    <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">Soon</span>
                </span>
                <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">Runs the backups of another DBackup, next to databases it cannot reach itself.</span>
            </span>
        </div>
    );
}

/**
 * The login page while nobody has an account: a first account, the restore of a configuration
 * backup of another DBackup, and the runner that comes later. DISABLE_EMAIL_LOGIN leaves the
 * restore, since the first account signs in with a password.
 */
export function FirstStart({ allowSignUp }: { allowSignUp: boolean }) {
    const [way, setWay] = useState<"choice" | "account" | "restore">("choice");
    const back = () => setWay("choice");

    if (way === "account") return <FirstAccountForm onBack={back} />;
    if (way === "restore") return <SetupRestore onBack={back} />;

    return (
        <div className="w-full max-w-md">
            <LoginHeading title="Welcome to DBackup" sub="Nobody has an account here yet. How do you want to start?" />
            <div className="space-y-2.5">
                <Way
                    icon={UserPlus}
                    tone="create"
                    title="Start fresh"
                    text={allowSignUp ? "Create the first account. It becomes the SuperAdmin of this DBackup." : "Off, since DISABLE_EMAIL_LOGIN turns passwords off on this container."}
                    onClick={() => setWay("account")}
                    disabled={!allowSignUp}
                />
                <Way icon={RotateCcw} tone="warning" title="Restore a backup" text="Bring back a DBackup with its accounts, connections, jobs and keys." onClick={() => setWay("restore")} />
                <SoonWay />
            </div>
            <p className="mt-4 text-xs text-muted-foreground">Only while nobody has an account here.</p>
        </div>
    );
}
