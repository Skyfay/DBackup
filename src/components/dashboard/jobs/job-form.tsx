"use client";

import { useState } from "react";
import { useFieldArray } from "react-hook-form";
import { Bell, CalendarClock, Database, HardDrive, Loader2, Lock, Pencil, Plus, SlidersHorizontal, type LucideIcon } from "lucide-react";
import { SectionRail, SectionSelect, type NavEntry } from "@/components/adapter/connection-form-nav";
import { Button } from "@/components/ui/button";
import { DIALOG_FOOTER, DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { DialogClose, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Form } from "@/components/ui/form";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { toneAttribute, type Tone } from "@/components/ui/tone";
import { STORAGE_ROLES } from "@/lib/core/storage-roles";
import { cn } from "@/lib/utils";
import { JOB_PARTS, firstPartWithError, jobErrorKeys, jobPartStatuses, type JobPart, type JobPartId } from "./job-form-layout";
import type { AdapterOption, EncryptionOption, JobFormJob } from "./job-form-schema";
import { BasicsPart, EncryptionPart, NotificationsPart } from "./job-parts";
import { AdvancedPart } from "./job-part-advanced";
import { AddDestinationButton, DestinationsPart } from "./job-part-destinations";
import { SourcePart } from "./job-part-source";
import { useJobForm } from "./use-job-form";

const PART_ICONS: Record<JobPartId, LucideIcon> = {
    basics: CalendarClock,
    source: Database,
    destinations: HardDrive,
    encryption: Lock,
    notifications: Bell,
    advanced: SlidersHorizontal,
};

const PARTS: NavEntry[] = JOB_PARTS.map((part) => ({ id: part.id, label: part.label, icon: PART_ICONS[part.id] }));

function PartHeading({ part, action }: { part: JobPart; action?: React.ReactNode }) {
    return (
        <div className="flex items-start justify-between gap-3">
            <div className="grid min-w-0 gap-0.5">
                <h3 className="font-semibold">{part.label}</h3>
                <p className="text-sm text-muted-foreground">{part.description}</p>
            </div>
            {action}
        </div>
    );
}

export interface JobFormProps {
    sources: AdapterOption[];
    /** Every storage connection. Only the ones in the destination role are offered as destinations. */
    destinations: AdapterOption[];
    /** Storage connections set up as directory sources. */
    directorySourceOptions: AdapterOption[];
    notifications: AdapterOption[];
    encryptionProfiles: EncryptionOption[];
    initialData: JobFormJob | null;
    onSaved: () => void;
}

/**
 * Adding or editing a backup job, split into parts like the connection form: a list on the left,
 * one part at a time beside it at a fixed height, and every part stays mounted, so nothing typed
 * is lost on the way. Each entry shows a check once its part has what the job needs, and Create
 * moves to the first part with a problem.
 */
export function JobForm({ sources, destinations, directorySourceOptions, notifications, encryptionProfiles, initialData, onSaved }: JobFormProps) {
    const state = useJobForm({ sources, initialData, onSaved });
    const { form } = state;
    const destinationArray = useFieldArray({ control: form.control, name: "destinations" });
    const [picked, setPicked] = useState<JobPartId>("basics");
    const values = form.watch();
    const { errors, isSubmitting } = form.formState;
    const statuses = jobPartStatuses(values, jobErrorKeys(errors));
    // DESTINATION is the column default, so a connection without a role is a destination too.
    const destinationOptions = destinations.filter((option) => (option.storageRole ?? STORAGE_ROLES.DESTINATION) === STORAGE_ROLES.DESTINATION);

    const submit = form.handleSubmit(state.save, (invalid) => {
        const target = firstPartWithError(jobErrorKeys(invalid));
        if (target) setPicked(target);
    });

    // Blue while a job is added, violet while one is edited. The form hands the tone to its head,
    // its main button and the cards, switches and fields in it.
    const tone: Tone = initialData ? "edit" : "create";

    const body = (id: JobPartId) => {
        switch (id) {
            case "basics":
                return <BasicsPart jobId={initialData?.id} />;
            case "source":
                return <SourcePart sources={sources} folderOptions={directorySourceOptions} defaultExcludePresetIds={state.defaultExcludePresetIds} />;
            case "destinations":
                return <DestinationsPart options={destinationOptions} array={destinationArray} />;
            case "encryption":
                return <EncryptionPart encryptionProfiles={encryptionProfiles} />;
            case "notifications":
                return <NotificationsPart notifications={notifications} />;
            case "advanced":
                return <AdvancedPart isPostgres={state.isPostgres} pgMajorVersion={state.pgMajorVersion} nativeCompression={state.nativeCompression} />;
        }
    };

    return (
        <Form {...form}>
            <form onSubmit={submit} noValidate {...toneAttribute(tone)} className="flex min-h-0 flex-1 flex-col">
                <DialogHead tone={tone} icon={initialData ? Pencil : Plus}>
                    <DialogTitle className="text-base">{initialData ? "Edit backup job" : "New backup job"}</DialogTitle>
                    <DialogDescription className={cn(dialogNoteClass(tone), "truncate")}>
                        {initialData ? initialData.name : "What goes in, where it goes and when"}
                    </DialogDescription>
                </DialogHead>

                <Tabs
                    orientation="vertical"
                    value={picked}
                    onValueChange={(value) => setPicked(value as JobPartId)}
                    className="min-h-0 flex-1 gap-0 md:h-[min(34rem,calc(95dvh-9.5rem))] md:flex-none md:flex-row"
                >
                    <SectionSelect sections={PARTS} statuses={statuses} value={picked} onValueChange={(value) => setPicked(value as JobPartId)} />
                    <SectionRail sections={PARTS} statuses={statuses} />
                    {/* The height is capped on the viewport, on a phone where the parent has none of its own.
                        From md up the part fills the fixed height beside the list. */}
                    <ScrollArea className="min-h-0 min-w-0 flex-1 *:data-[slot=scroll-area-viewport]:max-h-[calc(95dvh-15rem)] md:h-full md:*:data-[slot=scroll-area-viewport]:max-h-none [&>[data-slot=scroll-area-viewport]>div]:block!">
                        {JOB_PARTS.map((part) => (
                            <TabsContent key={part.id} value={part.id} forceMount className="space-y-5 p-5 data-[state=inactive]:hidden">
                                <PartHeading
                                    part={part}
                                    action={part.id === "destinations" ? <AddDestinationButton options={destinationOptions} array={destinationArray} /> : undefined}
                                />
                                {body(part.id)}
                            </TabsContent>
                        ))}
                    </ScrollArea>
                </Tabs>

                <div className={cn(DIALOG_FOOTER, "flex flex-wrap items-center justify-between gap-3")}>
                    <span className="hidden text-xs text-muted-foreground sm:inline">
                        {initialData ? "Changes apply from the next run" : "Every part can be changed later"}
                    </span>
                    <div className="ml-auto flex shrink-0 items-center gap-2">
                        <DialogClose asChild>
                            <Button type="button" variant="ghost">Cancel</Button>
                        </DialogClose>
                        <Button type="submit" disabled={isSubmitting}>
                            {isSubmitting && <Loader2 className="animate-spin" />}
                            {initialData ? "Save changes" : "Create job"}
                        </Button>
                    </div>
                </div>
            </form>
        </Form>
    );
}
