"use client";

import { ArrowLeft, ArrowRight, Check, Database, FolderOpen, KeyRound, Loader2, RotateCcw, X, XCircle } from "lucide-react";
import { DIALOG_FOOTER, DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { RestoreFailure } from "./use-restore-start";

export type RestoreStep = "databases" | "files";

interface StepInfo {
    detail: string;
    done: boolean;
}

/** The two steps of a backup with databases and folders: first the databases, then the files. */
export function RestoreSteps({ step, onStep, databases, files }: { step: RestoreStep; onStep: (step: RestoreStep) => void; databases: StepInfo; files: StepInfo }) {
    const steps = [
        { id: "databases" as const, number: 1, title: "Databases", icon: Database, ...databases },
        { id: "files" as const, number: 2, title: "Files", icon: FolderOpen, ...files },
    ];
    return (
        <nav aria-label="Restore steps" className="grid gap-2 sm:grid-cols-2 md:gap-3">
            {steps.map((entry) => {
                const active = entry.id === step;
                return (
                    <button
                        key={entry.id}
                        type="button"
                        aria-current={active ? "step" : undefined}
                        onClick={() => onStep(entry.id)}
                        className={cn(
                            "flex min-w-0 items-center gap-3 rounded-xl border bg-card px-4 py-3 text-left shadow-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
                            active ? "border-foreground/40" : "hover:border-foreground/20"
                        )}
                    >
                        <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold", active ? "bg-foreground text-background" : entry.done ? "bg-success/15 text-success" : "bg-muted text-muted-foreground")}>
                            {entry.done && !active ? <Check className="size-3.5" aria-hidden="true" /> : entry.number}
                        </span>
                        <entry.icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <span className="min-w-0">
                            <span className="block text-sm font-semibold">{entry.title}</span>
                            <span className="block truncate text-xs text-muted-foreground">{entry.detail}</span>
                        </span>
                    </button>
                );
            })}
        </nav>
    );
}

interface RestoreBarProps {
    title: string;
    detail: string;
    /** Why the button waits, shown instead of the detail. */
    blocker: string | null;
    onCancel: () => void;
    onBack?: () => void;
    next?: { label: string; onClick: () => void };
    action: { label: string; onClick: () => void; pending: boolean; tone?: "warning" | "destructive" };
}

/**
 * The bar at the foot of the page, which stays while it scrolls: what the restore does in one
 * sentence, and the button that starts it, or the next step.
 */
export function RestoreBar({ title, detail, blocker, onCancel, onBack, next, action }: RestoreBarProps) {
    const tone = action.tone ?? "warning";
    return (
        <div className="sticky bottom-3 z-20 flex flex-wrap items-center gap-3 rounded-xl border bg-raised px-4 py-3 shadow-lg md:bottom-4">
            <RotateCcw className={cn("hidden size-5 shrink-0 sm:block", tone === "warning" ? "text-warning" : "text-destructive")} aria-hidden="true" />
            <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{title}</p>
                <p className={cn("truncate text-xs", blocker ? "text-warning" : "text-muted-foreground")}>{blocker ?? detail}</p>
            </div>
            <div className="flex w-full gap-2 sm:w-auto">
                {onBack && (
                    <Button variant="outline" className="flex-1 sm:flex-none" onClick={onBack}>
                        <ArrowLeft />
                        Back
                    </Button>
                )}
                <Button variant="outline" className="flex-1 sm:flex-none" onClick={onCancel} disabled={action.pending}>
                    Cancel
                </Button>
                {next ? (
                    <Button className="flex-1 sm:flex-none" onClick={next.onClick}>
                        {next.label}
                        <ArrowRight />
                    </Button>
                ) : (
                    <Button tone={tone} className="flex-1 sm:flex-none" onClick={action.onClick} disabled={!!blocker || action.pending}>
                        {action.pending ? <Loader2 className="animate-spin" /> : <RotateCcw />}
                        {action.label}
                    </Button>
                )}
            </div>
        </div>
    );
}

interface FailureProps {
    failure: RestoreFailure;
    onDismiss: () => void;
    adminUser: string;
    onAdminUser: (value: string) => void;
    adminPassword: string;
    onAdminPassword: (value: string) => void;
    restoring: boolean;
    onRetry: () => void;
}

/**
 * A start the server turned down: why, and when it lacked the rights to create a database, a login
 * with more rights for this one run. The choices stay below, so something else can be picked too.
 */
export function RestoreFailureCard({ failure, onDismiss, adminUser, onAdminUser, adminPassword, onAdminPassword, restoring, onRetry }: FailureProps) {
    return (
        <div className="space-y-4">
            <div role="alert" className="relative flex items-start gap-3 overflow-hidden rounded-xl border border-destructive/30 bg-destructive/5 p-4 pl-5">
                <span className="absolute inset-y-0 left-0 w-1 bg-destructive" aria-hidden="true" />
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-destructive/12 text-destructive" aria-hidden="true">
                    <XCircle className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                    <p className="font-medium">The restore could not start</p>
                    <p className="mt-0.5 text-sm break-words text-muted-foreground">{failure.error} Nothing was changed. Change the choices below and start again{failure.needsAdmin ? ", or try once with an admin login" : ""}.</p>
                </div>
                <Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label="Hide this message" onClick={onDismiss}>
                    <X />
                </Button>
            </div>
            {failure.needsAdmin && (
                <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
                    <DialogHead tone="warning" icon={KeyRound}>
                        <h3 className="text-base font-semibold">An admin login for this restore</h3>
                        <p className={dialogNoteClass("warning")}>Used once for this run and not saved</p>
                    </DialogHead>
                    <div className="grid gap-4 p-5 sm:grid-cols-2">
                        <div className="space-y-2">
                            <Label htmlFor="restore-admin-user">User</Label>
                            <Input id="restore-admin-user" value={adminUser} onChange={(event) => onAdminUser(event.target.value)} autoComplete="off" />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="restore-admin-password">Password</Label>
                            <Input id="restore-admin-password" type="password" value={adminPassword} onChange={(event) => onAdminPassword(event.target.value)} autoComplete="off" />
                        </div>
                    </div>
                    <div className={cn(DIALOG_FOOTER, "flex flex-wrap items-center justify-between gap-3")}>
                        <p className="text-xs text-muted-foreground">It creates the databases, the restore then runs as the login of the server.</p>
                        <Button tone="warning" onClick={onRetry} disabled={restoring || !adminUser}>
                            {restoring ? <Loader2 className="animate-spin" /> : <RotateCcw />}
                            Try again with this login
                        </Button>
                    </div>
                </section>
            )}
        </div>
    );
}
