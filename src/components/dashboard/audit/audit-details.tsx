"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight, ChevronRight, ListFilter, LogOut, MapPin, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { revokeUserSessions } from "@/app/actions/auth/user-security";
import { FactList, Section } from "@/components/adapter/connection-details-sections";
import { Notice } from "@/components/dashboard/storage/restore/restore-parts";
import { LinesSkeleton } from "@/components/dashboard/users/user-details-sections";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { usePageModel } from "@/hooks/use-page-model";
import { useDateFormatter } from "@/hooks/use-date-formatter";
import { listWords } from "@/lib/auth/access-summary";
import { AUDIT_ACTIONS } from "@/lib/core/audit-types";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { cn } from "@/lib/utils";
import type { AuditDetails as AuditDetailsModel, AuditRow } from "@/services/audit/audit-types";
import { ActorFace, DeletedTag, GLYPHS, marked, NewPlaceBadge, Sentence } from "./audit-cells";
import { ChangeRows, EntryLines, METHOD_WORDS } from "./audit-details-parts";

const log = logger.child({ component: "audit-details" });

interface AuditDetailsProps {
    open: boolean;
    /** Stays set while the panel slides out, so its content does not vanish halfway. */
    row: AuditRow | null;
    onClose: () => void;
    /** Shows only the entries of the record of this one. */
    onRecord: (row: AuditRow) => void;
    /** May sign people out, which changes users. */
    canSignOut: boolean;
    /** Only a SuperAdmin signs out a SuperAdmin, so anyone else gets no Sign out everywhere for one. */
    viewerSuperAdmin: boolean;
}

/** Everything about one entry in a panel from the right: what changed, who did it from where, and the entries around it. */
export function AuditDetails(props: AuditDetailsProps) {
    const { open, row, onClose } = props;
    return (
        <Sheet open={open && row !== null} onOpenChange={(next) => !next && onClose()}>
            <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-xl">
                {row && <Content {...props} row={row} />}
            </SheetContent>
        </Sheet>
    );
}

function Content({ row, onRecord, canSignOut, viewerSuperAdmin }: AuditDetailsProps & { row: AuditRow }) {
    const { model } = usePageModel<AuditDetailsModel>(`/api/audit/${encodeURIComponent(row.id)}`, "The entry could not be loaded.");
    const details = model?.id === row.id ? model : null;
    const { formatDate } = useDateFormatter();
    const [asking, setAsking] = useState(false);
    const [showStored, setShowStored] = useState(false);
    const Icon = GLYPHS[row.glyph];
    const isSignIn = row.action === AUDIT_ACTIONS.LOGIN;
    const failed = row.action === AUDIT_ACTIONS.LOGIN_FAILED;
    const userId = row.actor.kind === "person" && row.actor.key.startsWith("user:") ? row.actor.key.slice(5) : null;
    const time = (at: string) => formatDate(at, "p");

    return (
        <>
            <SheetHeader className="gap-4 border-b p-5 pr-12">
                <div className="flex min-w-0 items-start gap-3">
                    <span
                        className={cn(
                            "flex size-11 shrink-0 items-center justify-center rounded-lg border",
                            marked(row.kind) ? "border-warning/35 bg-warning/10 text-warning" : "bg-muted"
                        )}
                        aria-hidden="true"
                    >
                        <Icon className="size-5" />
                    </span>
                    <div className="min-w-0">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <SheetTitle className="min-w-0 text-base font-semibold">
                                {!failed && row.actor.kind !== "unknown" && <span className="text-muted-foreground">{row.actor.name} </span>}
                                <Sentence parts={failed || row.actor.kind === "unknown" ? row.parts : lowered(row.parts)} />
                            </SheetTitle>
                            {row.newPlace && <NewPlaceBadge />}
                        </div>
                        <SheetDescription className="text-sm text-muted-foreground">
                            {formatDate(row.at, "PP pp")} · <RelativeTime date={row.at} />
                        </SheetDescription>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {details?.record && (
                        <Button asChild variant="outline" size="sm">
                            <Link href={details.record.href}>
                                <ArrowUpRight />
                                {details.record.label}
                            </Link>
                        </Button>
                    )}
                    {row.resourceId && !isSignIn && (
                        <Button variant="outline" size="sm" onClick={() => onRecord(row)}>
                            <ListFilter />
                            Every entry of this record
                        </Button>
                    )}
                    {isSignIn && canSignOut && userId && (viewerSuperAdmin || !row.actor.superAdmin) && (
                        <Button variant="ghost-destructive" size="sm" onClick={() => setAsking(true)}>
                            <LogOut />
                            Sign out everywhere
                        </Button>
                    )}
                </div>
            </SheetHeader>

            <ScrollArea className="min-h-0 flex-1">
                <div className="space-y-6 p-5">
                    {row.newPlace && details && (
                        <Notice tone="warning" icon={MapPin}>
                            The first sign-in of {row.actor.name} from this network in the {details.keptDays} days the log keeps.
                            {details.usualNetworks.length > 0 && ` Before, they signed in from ${listWords(details.usualNetworks)}.`}
                        </Notice>
                    )}

                    {!details ? (
                        <LinesSkeleton rows={3} />
                    ) : (
                        <>
                            {details.changes.length > 0 && (
                                <Section title="What changed" aside={`${details.changes.length} ${details.changes.length === 1 ? "change" : "changes"}`}>
                                    <ChangeRows rows={details.changes} />
                                </Section>
                            )}

                            {(isSignIn || failed) && (
                                <Section title="Where from">
                                    <FactList
                                        columns={1}
                                        facts={[
                                            { label: "Address", value: row.ipAddress ?? "not known" },
                                            { label: "Browser", value: <span title={details.browser ?? undefined}>{row.device ?? "not known"}</span> },
                                            ...(isSignIn && details.session
                                                ? [{
                                                      label: "Session",
                                                      value: details.session.endedAt
                                                          ? `${details.session.signedOut ? "signed out" : "until the next sign-in"} at ${time(details.session.endedAt)}`
                                                          : "no sign-out or new sign-in since",
                                                  }]
                                                : []),
                                        ]}
                                    />
                                    {failed && (
                                        <p className="flex items-center gap-2 text-xs text-muted-foreground">
                                            <ShieldAlert className="size-3.5 shrink-0" aria-hidden="true" />
                                            Settings, Rate limits decides how many tries an address gets before it has to wait.
                                        </p>
                                    )}
                                </Section>
                            )}

                            {!isSignIn && !failed && (
                                <Section title="Who">
                                    <div className="flex min-w-0 items-center gap-3">
                                        <ActorFace actor={row.actor} size="md" />
                                        <div className="min-w-0">
                                            <div className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                                                <span className="truncate">{row.actor.name}</span>
                                                {row.actor.deleted && <DeletedTag />}
                                                {row.actor.sub && !row.actor.deleted && <span className="truncate text-xs font-normal text-muted-foreground">{row.actor.sub}</span>}
                                            </div>
                                            <div className="truncate text-xs text-muted-foreground">
                                                {details.signIn
                                                    ? `Signed in at ${time(details.signIn.at)}${details.signIn.method && METHOD_WORDS[details.signIn.method] ? ` with ${METHOD_WORDS[details.signIn.method]}` : ""}${details.signIn.device ? `, ${details.signIn.device}` : ""}${details.signIn.ipAddress ? `, ${details.signIn.ipAddress}` : ""}`
                                                    : row.actor.kind === "key" ? "Through the API, with the permissions of the key" : [row.device, row.ipAddress].filter(Boolean).join(", ") || "Where from is not known"}
                                            </div>
                                        </div>
                                    </div>
                                </Section>
                            )}

                            {isSignIn && details.session && (
                                <Section title="In this session" aside={details.session.endedAt ? `${time(row.at)} to ${time(details.session.endedAt)}` : `since ${time(row.at)}`}>
                                    {details.session.lines.length === 0 ? (
                                        <p className="text-sm text-muted-foreground">Nothing in the log.</p>
                                    ) : (
                                        <EntryLines lines={details.session.lines} withWho={false} time={time} />
                                    )}
                                </Section>
                            )}

                            {details.earlier.length > 0 && (
                                <Section title="Earlier entries of this record" aside={`the audit log keeps ${details.keptDays} days`}>
                                    <EntryLines lines={details.earlier} />
                                </Section>
                            )}

                            {details.stored && (
                                <Section
                                    title="Stored details"
                                    aside={
                                        <button type="button" onClick={() => setShowStored((current) => !current)} className="inline-flex items-center gap-1 rounded-sm font-medium text-foreground outline-none hover:underline hover:underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring/50">
                                            <ChevronRight className={cn("size-3.5 transition-transform", showStored && "rotate-90")} aria-hidden="true" />
                                            {showStored ? "Hide" : "Show"}
                                        </button>
                                    }
                                >
                                    {showStored ? <CodeBlock name="details.json" code={details.stored} language="json" /> : <p className="text-sm text-muted-foreground">What the entry holds, as it was written.</p>}
                                </Section>
                            )}
                        </>
                    )}
                </div>
            </ScrollArea>

            {asking && userId && (
                <ConfirmDialog
                    open
                    onOpenChange={(next) => !next && setAsking(false)}
                    title={`Sign out ${row.actor.name} everywhere?`}
                    note="Every browser has to sign in again"
                    description="Their sessions end at once, the one from this sign-in included. Their API keys keep working."
                    icon={LogOut}
                    confirmLabel="Sign out everywhere"
                    destructive
                    onConfirm={async () => {
                        try {
                            const result = await revokeUserSessions(userId);
                            if (result.success) toast.success(`${row.actor.name} is signed out`);
                            else toast.error(result.error || "That did not work.");
                        } catch (error) {
                            // Without the right to change users the action throws instead of answering.
                            log.warn("Signing a user out failed", { userId }, wrapError(error));
                            toast.error("That did not work.");
                        }
                        setAsking(false);
                    }}
                />
            )}
        </>
    );
}

/** "Changed the job" after a name reads "Manu changed the job". */
function lowered(parts: AuditRow["parts"]): AuditRow["parts"] {
    if (parts.length === 0 || parts[0].strong) return parts;
    const [first, ...rest] = parts;
    return [{ ...first, text: first.text.charAt(0).toLowerCase() + first.text.slice(1) }, ...rest];
}
