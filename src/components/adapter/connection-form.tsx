"use client";

import { useState } from "react";
import {
    Activity, ChevronLeft, CircleCheck, Container, Database, FileDown, FileText, Folder, Gauge, List, Loader2, Pencil, Plug, Plus,
    SlidersHorizontal, SquareTerminal, TriangleAlert, Zap, type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, DIALOG_FOOTER, DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { DialogClose, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Form } from "@/components/ui/form";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent } from "@/components/ui/tabs";
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
import { SecretStatusProvider } from "./secret-status-context";
import { storageLayout } from "./storage-form-layout";
import { StorageSection, StorageSectionAction } from "./storage-form-sections";
import type { AdapterConfig } from "./types";
import { useConnectionForm, type ConnectionTestState } from "./use-connection-form";

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
    behavior: Activity,
};

/** What the connection is called in the title and on the Create button, by type and role. */
function wording(adapter: AdapterDefinition, role: StorageRole): { noun: string; short: string } {
    if (adapter.type === "storage") {
        return role === STORAGE_ROLES.SOURCE
            ? { noun: "directory source", short: "source" }
            : { noun: "backup destination", short: "destination" };
    }
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

/** What the last test said, beside the button. It goes as soon as a field changes. */
function TestResult({ state }: { state: ConnectionTestState }) {
    if (state.status === "passed") {
        const text = state.version ? `Connected · ${state.version}` : "Connected";
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
                <span className="truncate" title={state.message}>Connection failed</span>
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
    /** Only while adding: back to the type picker. */
    onBack?: () => void;
    onSaved: () => void;
}

/**
 * Adding or editing a database or storage connection.
 *
 * The form is split into parts listed on the left, and only one part shows at a time. Every
 * part stays mounted, so nothing typed is lost on the way, and the list shows which parts are
 * done and which still hold a problem. Create moves to the first part with one.
 */
export function ConnectionForm({ adapter, initialData, defaultRole, onBack, onSaved }: ConnectionFormProps) {
    const connection = useConnectionForm({ adapter, initialData, defaultRole, onSaved });
    const { form, sectionProps } = connection;
    const config = form.watch("config") ?? {};
    const name = form.watch("name");
    const { errors, isSubmitting } = form.formState;
    const isStorage = adapter.type === "storage";
    const { noun, short } = wording(adapter, connection.storageRole);

    const layout = isStorage ? storageLayout(adapter, config, connection.storageRole) : databaseLayout(adapter, config);
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
    const Section = isStorage ? StorageSection : DatabaseSection;
    const SectionAction = isStorage ? StorageSectionAction : DatabaseSectionAction;

    return (
        <>
            <Form {...form}>
                <SecretStatusProvider value={initialData?.secretStatus ?? {}}>
                    <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
                        <DialogHead
                            tone="info"
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
                            <DialogTitle className="text-base">{initialData ? `Edit ${noun}` : `Add ${noun}`}</DialogTitle>
                            <DialogDescription className={cn(dialogNoteClass("info"), "truncate")}>
                                {initialData ? `${initialData.name} · ${adapter.name}` : `${adapter.name} · Step 2 of 2`}
                            </DialogDescription>
                        </DialogHead>

                        <Tabs
                            orientation="vertical"
                            value={active}
                            onValueChange={(value) => setPicked(value as SectionId)}
                            className="min-h-0 flex-1 gap-0 md:h-[min(32rem,calc(95dvh-9.5rem))] md:flex-none md:flex-row"
                        >
                            <SectionSelect sections={sections} statuses={statuses} value={active} onValueChange={(value) => setPicked(value as SectionId)} />
                            <SectionRail sections={sections} statuses={statuses} />
                            {/* The height is capped on the viewport, on a phone where the parent has none of its own.
                                From md up the part fills the fixed height beside the list. */}
                            <ScrollArea className="min-h-0 min-w-0 flex-1 *:data-[slot=scroll-area-viewport]:max-h-[calc(95dvh-15rem)] md:h-full md:*:data-[slot=scroll-area-viewport]:max-h-none [&>[data-slot=scroll-area-viewport]>div]:block!">
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
                                    {connection.test.status === "running" ? <Loader2 className="animate-spin" /> : <Zap />}
                                    Test connection
                                </Button>
                                <TestResult state={connection.test} />
                            </div>
                            <div className="ml-auto flex shrink-0 items-center gap-2">
                                <DialogClose asChild>
                                    <Button type="button" variant="ghost">Cancel</Button>
                                </DialogClose>
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
