"use client";

import { useState } from "react";
import {
    Activity, ChevronLeft, CircleCheck, Container, Database, FileDown, FileText, Folder, Gauge, List, Loader2, MessageSquare, Pencil,
    Plug, Plus, Send, SlidersHorizontal, SquareTerminal, TriangleAlert, Zap, type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, DIALOG_FOOTER, DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { DialogClose, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Form } from "@/components/ui/form";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { toneAttribute, type Tone } from "@/components/ui/tone";
import type { AdapterDefinition } from "@/lib/adapters/definitions";
import { STORAGE_ROLES, type StorageRole } from "@/lib/core/storage-roles";
import { cn } from "@/lib/utils";
import {
    AUTHORIZED_KEY, LOGIN_KEY, NAME_KEY, SSH_LOGIN_KEY, errorKeysOf, firstSectionWithError, sectionStatuses,
    type SectionId, type SectionLayout,
} from "./connection-form-layout";
import { SectionRail, SectionSelect, type NavSection } from "./connection-form-nav";
import { databaseLayout } from "./database-form-layout";
import { DatabaseSection, DatabaseSectionAction } from "./database-form-sections";
import { notificationLayout } from "./notification-form-layout";
import { NotificationSection, NotificationSectionAction } from "./notification-form-sections";
import { SecretStatusProvider } from "./secret-status-context";
import { storageLayout } from "./storage-form-layout";
import { StorageSection, StorageSectionAction } from "./storage-form-sections";
import type { AdapterConfig } from "./types";
import { useConnectionForm, type ConnectionTestState, type SavedConnection } from "./use-connection-form";

const SECTION_ICONS: Record<SectionId, LucideIcon> = {
    connection: Plug,
    ssh: SquareTerminal,
    database: Database,
    file: FileText,
    aliases: List,
    transfer: FileDown,
    service: Container,
    location: Folder,
    options: SlidersHorizontal,
    speed: Gauge,
    message: MessageSquare,
    behavior: Activity,
};

/** What the connection is called in the title and on the Create button, by type and role. */
function wording(adapter: AdapterDefinition, role: StorageRole): { noun: string; short: string } {
    if (adapter.type === "storage") {
        return role === STORAGE_ROLES.SOURCE
            ? { noun: "directory source", short: "source" }
            : { noun: "backup destination", short: "destination" };
    }
    if (adapter.type === "notification") return { noun: "notification channel", short: "channel" };
    return { noun: "database", short: "database" };
}

function SectionHeading({ section, action }: { section: SectionLayout; action: React.ReactNode }) {
    return (
        <div className="flex items-start justify-between gap-3">
            <div className="grid min-w-0 gap-0.5">
                <h3 className="font-semibold">{section.label}</h3>
                {section.description && <p className="text-sm text-muted-foreground">{section.description}</p>}
            </div>
            {action}
        </div>
    );
}

/**
 * What the last test said, beside the button. It goes as soon as a field changes. A channel is
 * tested by sending a real message, so its result says that instead of connected.
 */
function TestResult({ state, messaging }: { state: ConnectionTestState; messaging: boolean }) {
    if (state.status === "passed") {
        const text = messaging ? "Test message sent" : state.version ? `Connected · ${state.version}` : "Connected";
        return (
            <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-success">
                <CircleCheck className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate" title={text}>{text}</span>
            </span>
        );
    }
    if (state.status === "failed") {
        return (
            <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-warning">
                <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate" title={state.message}>{messaging ? "Sending failed" : "Connection failed"}</span>
            </span>
        );
    }
    return null;
}

interface ConnectionFormProps {
    adapter: AdapterDefinition;
    initialData?: AdapterConfig;
    /** The role a new storage connection starts in, from the page it is added on. */
    defaultRole?: StorageRole;
    /** Keeps a new storage connection in `defaultRole` instead of asking, like the setup does for its destination. */
    lockRole?: boolean;
    /** Only while adding: back to the type picker. */
    onBack?: () => void;
    /** Where adding stands, after the type in the head. */
    step?: string;
    /**
     * A dialog, or a panel on a page like the setup. On a page the head is plain headings and
     * there is no Cancel, since there is no dialog to close.
     */
    container?: "dialog" | "page";
    onSaved: (saved?: SavedConnection) => void;
}

/**
 * Adding or editing a connection: a database, a storage connection or a notification channel.
 *
 * The form is split into parts listed on the left, and only one part shows at a time. Every
 * part stays mounted, so nothing typed is lost on the way, and the list shows which parts are
 * done and which still hold a problem. Create moves to the first part with one. A connection
 * with a single part, like a Teams webhook, has no list, which would only hold that one entry.
 */
export function ConnectionForm({
    adapter,
    initialData,
    defaultRole,
    lockRole,
    onBack,
    step = "Step 2 of 2",
    container = "dialog",
    onSaved,
}: ConnectionFormProps) {
    const connection = useConnectionForm({ adapter, initialData, defaultRole, lockRole, onSaved });
    const { form, sectionProps } = connection;
    const config = form.watch("config") ?? {};
    const name = form.watch("name");
    const { errors, isSubmitting } = form.formState;
    const isStorage = adapter.type === "storage";
    const isNotification = adapter.type === "notification";
    const { noun, short } = wording(adapter, connection.storageRole);

    const layout = isStorage
        ? storageLayout(adapter, config, connection.storageRole)
        : isNotification ? notificationLayout(adapter) : databaseLayout(adapter, config);
    const single = layout.length === 1;
    const sections: NavSection[] = layout.map((section) => ({ ...section, icon: SECTION_ICONS[section.id] }));
    const [picked, setPicked] = useState<SectionId>("connection");
    // Switching the mode can take the picked part away, like the SSH server when going direct.
    const active = layout.some((section) => section.id === picked) ? picked : layout[0].id;

    const values = {
        ...config,
        [NAME_KEY]: name,
        [LOGIN_KEY]: connection.primaryCredentialId,
        [SSH_LOGIN_KEY]: connection.sshCredentialId,
        [AUTHORIZED_KEY]: connection.authorized || undefined,
    };
    const statuses = sectionStatuses(layout, values, errorKeysOf(errors));

    const submit = form.handleSubmit(connection.onValid, (invalid) => {
        const target = firstSectionWithError(layout, errorKeysOf(invalid));
        if (target) setPicked(target);
    });

    const busy = isSubmitting || connection.saving;
    // Blue while a connection is added, violet while one is edited. The form hands the tone to its
    // head, its Create or Save button and the cards picked in it.
    const tone: Tone = initialData ? "edit" : "create";
    const Section = isStorage ? StorageSection : isNotification ? NotificationSection : DatabaseSection;
    const SectionAction = isStorage ? StorageSectionAction : isNotification ? NotificationSectionAction : DatabaseSectionAction;
    const inDialog = container === "dialog";
    const title = initialData ? `Edit ${noun}` : `Add ${noun}`;
    const note = initialData ? `${initialData.name} · ${adapter.name}` : `${adapter.name} · ${step}`;

    return (
        <>
            <Form {...form}>
                <SecretStatusProvider value={initialData?.secretStatus ?? {}}>
                    <form onSubmit={submit} noValidate data-single-part={single || undefined} {...toneAttribute(tone)} className="flex min-h-0 flex-1 flex-col">
                        <DialogHead
                            tone={tone}
                            icon={initialData ? Pencil : Plus}
                            action={
                                onBack && (
                                    <Button type="button" variant="outline" size="sm" onClick={onBack}>
                                        <ChevronLeft />
                                        Change type
                                    </Button>
                                )
                            }
                        >
                            {inDialog ? (
                                <>
                                    <DialogTitle className="text-base">{title}</DialogTitle>
                                    <DialogDescription className={cn(dialogNoteClass(tone), "truncate")}>{note}</DialogDescription>
                                </>
                            ) : (
                                <>
                                    <h2 className="text-base leading-none font-semibold">{title}</h2>
                                    <p className={cn(dialogNoteClass(tone), "truncate")}>{note}</p>
                                </>
                            )}
                        </DialogHead>

                        <Tabs
                            orientation="vertical"
                            value={active}
                            onValueChange={(value) => setPicked(value as SectionId)}
                            className={cn("min-h-0 flex-1 gap-0", !single && "md:h-[min(32rem,calc(95dvh-9.5rem))] md:flex-none md:flex-row")}
                        >
                            {!single && (
                                <>
                                    <SectionSelect sections={sections} statuses={statuses} value={active} onValueChange={(value) => setPicked(value as SectionId)} />
                                    <SectionRail sections={sections} statuses={statuses} />
                                </>
                            )}
                            {/* The height is capped on the viewport, on a phone where the parent has none of its own.
                                From md up the part fills the fixed height beside the list, and a single part
                                keeps its own height, capped the same way. */}
                            <ScrollArea
                                className={cn(
                                    "min-h-0 min-w-0 flex-1 [&>[data-slot=scroll-area-viewport]>div]:block!",
                                    single
                                        ? "*:data-[slot=scroll-area-viewport]:max-h-[calc(95dvh-9.5rem)]"
                                        : "*:data-[slot=scroll-area-viewport]:max-h-[calc(95dvh-15rem)] md:h-full md:*:data-[slot=scroll-area-viewport]:max-h-none"
                                )}
                            >
                                {sections.map((section) => (
                                    <TabsContent key={section.id} value={section.id} forceMount className="space-y-5 p-5 data-[state=inactive]:hidden">
                                        <SectionHeading
                                            section={section}
                                            action={<SectionAction id={section.id} adapter={adapter} sshCredentialId={connection.sshCredentialId} />}
                                        />
                                        <Section id={section.id} keys={section.keys} {...sectionProps} />
                                    </TabsContent>
                                ))}
                            </ScrollArea>
                        </Tabs>

                        <div className={cn(DIALOG_FOOTER, "flex flex-wrap items-center justify-between gap-3")}>
                            <div className="flex min-w-0 items-center gap-3" aria-live="polite">
                                <Button type="button" variant="outline" onClick={connection.runTest} disabled={connection.test.status === "running" || busy}>
                                    {connection.test.status === "running" ? <Loader2 className="animate-spin" /> : isNotification ? <Send /> : <Zap />}
                                    {/* A channel is tested by sending it a real message, so the button says so. */}
                                    {isNotification ? "Send test" : "Test connection"}
                                </Button>
                                <TestResult state={connection.test} messaging={isNotification} />
                            </div>
                            <div className="ml-auto flex shrink-0 items-center gap-2">
                                {inDialog && (
                                    <DialogClose asChild>
                                        <Button type="button" variant="ghost">Cancel</Button>
                                    </DialogClose>
                                )}
                                <Button type="submit" disabled={busy}>
                                    {busy && <Loader2 className="animate-spin" />}
                                    {initialData ? "Save changes" : `Create ${short}`}
                                </Button>
                            </div>
                        </div>
                    </form>
                </SecretStatusProvider>
            </Form>

            <ConfirmDialog
                open={connection.failure !== null}
                onOpenChange={(open) => !open && connection.dismissFailure()}
                tone="warning"
                title="Save without a working connection?"
                note="The connection test failed"
                description="DBackup could not reach the database with these settings. It can save them anyway, and the connection shows as offline until it is fixed."
                confirmLabel="Save anyway"
                isPending={connection.saving}
                onConfirm={connection.saveAnyway}
            >
                <p className="rounded-lg border bg-muted/40 p-3 font-mono text-xs break-all">{connection.failure?.message}</p>
            </ConfirmDialog>
        </>
    );
}
