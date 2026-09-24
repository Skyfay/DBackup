"use client";

import { Fragment, useRef, useState } from "react";
import { Icon, type IconifyIcon } from "@iconify/react";
import curlIcon from "@iconify-icons/simple-icons/curl";
import bashIcon from "@iconify-icons/simple-icons/gnubash";
import pythonIcon from "@iconify-icons/simple-icons/python";
import typescriptIcon from "@iconify-icons/simple-icons/typescript";
import goIcon from "@iconify-icons/simple-icons/go";
import githubActionsIcon from "@iconify-icons/simple-icons/githubactions";
import gitlabIcon from "@iconify-icons/simple-icons/gitlab";
import azureDevopsIcon from "@iconify-icons/simple-icons/azuredevops";
import ansibleIcon from "@iconify-icons/simple-icons/ansible";
import { Info, ListOrdered, Webhook, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CodeMark } from "@/components/ui/code-block";
import { DIALOG_FOOTER, DIALOG_SURFACE, DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { KEY_PLACEHOLDER, type TriggerExample, type TriggerTarget } from "./api-trigger-examples";
import { ExamplePart, OverviewPart, SetupPart, type CreatedKey } from "./api-trigger-parts";
import { PIPELINE_EXAMPLES } from "./api-trigger-pipelines";
import { SCRIPT_EXAMPLES } from "./api-trigger-scripts";

const LOGOS: Record<string, IconifyIcon> = {
    curl: curlIcon,
    bash: bashIcon,
    python: pythonIcon,
    typescript: typescriptIcon,
    go: goIcon,
    github: githubActionsIcon,
    gitlab: gitlabIcon,
    azure: azureDevopsIcon,
    ansible: ansibleIcon,
};

interface Part {
    id: string;
    label: string;
    description: string;
    /** An icon of the dialog, or the logo of the language or the CI. */
    icon: LucideIcon | IconifyIcon;
    example?: TriggerExample;
}

const START: Part[] = [
    { id: "overview", label: "Overview", description: "What a script needs to start this job and wait for it.", icon: Info },
    { id: "setup", label: "Setup", description: "A key, then the request that starts the job and the one that follows its run.", icon: ListOrdered },
];

const exampleParts = (examples: TriggerExample[]): Part[] =>
    examples.map((example) => ({ id: example.id, label: example.label, description: example.description, icon: LOGOS[example.id], example }));

const GROUPS: { label?: string; parts: Part[] }[] = [
    { parts: START },
    { label: "Scripts", parts: exampleParts(SCRIPT_EXAMPLES) },
    { label: "Pipelines", parts: exampleParts(PIPELINE_EXAMPLES) },
];

const PARTS = GROUPS.flatMap((group) => group.parts);

/** Iconify data carries the SVG body, a Lucide icon is a component. */
function PartIcon({ icon, className }: { icon: Part["icon"]; className?: string }) {
    if (typeof icon === "object" && "body" in icon) return <Icon icon={icon} className={className} aria-hidden="true" />;
    const Lucide = icon as LucideIcon;
    return <Lucide className={className} aria-hidden="true" />;
}

interface ApiTriggerDialogProps {
    jobId: string;
    jobName: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

/**
 * How to start a job from outside and follow its run, split into parts like the job form: an
 * Overview of the requests, a Setup that makes a key with the two rights it needs, and scripts
 * and pipelines that do both. A key made here fills into every example until the dialog closes,
 * which is also the only time it can be read.
 */
export function ApiTriggerDialog({ jobId, jobName, open, onOpenChange }: ApiTriggerDialogProps) {
    const [picked, setPicked] = useState("overview");
    const [created, setCreated] = useState<CreatedKey | null>(null);
    const viewport = useRef<HTMLDivElement>(null);
    const baseUrl = typeof window !== "undefined" ? window.location.origin : "https://your-dbackup-instance.com";
    const target: TriggerTarget = { baseUrl, jobId, apiKey: created?.key ?? KEY_PLACEHOLDER };
    const mark: CodeMark = { text: target.apiKey, tone: created ? "success" : "warning" };

    // Every part starts at its top, not where the last one was left.
    const pick = (id: string) => {
        setPicked(id);
        if (viewport.current) viewport.current.scrollTop = 0;
    };

    const body = (part: Part) => {
        const logo = <PartIcon icon={part.icon} />;
        if (part.example) return <ExamplePart example={part.example} target={target} mark={mark} icon={logo} />;
        if (part.id === "setup") return <SetupPart target={target} mark={mark} jobName={jobName} created={created} onCreated={setCreated} icon={<PartIcon icon={LOGOS.curl} />} />;
        return <OverviewPart target={target} mark={mark} />;
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent showCloseButton={false} className={cn(DIALOG_SURFACE, "sm:max-w-4xl")}>
                <div className="flex min-h-0 flex-1 flex-col">
                    <DialogHead tone="neutral" icon={Webhook}>
                        <DialogTitle className="text-base">API trigger</DialogTitle>
                        <DialogDescription className={cn(dialogNoteClass("neutral"), "truncate")}>{jobName}</DialogDescription>
                    </DialogHead>

                    <Tabs
                        orientation="vertical"
                        value={picked}
                        onValueChange={pick}
                        className="min-h-0 flex-1 gap-0 md:h-[min(38rem,calc(95dvh-9.5rem))] md:flex-none md:flex-row"
                    >
                        <div className="border-b px-5 py-3 md:hidden">
                            <Select value={picked} onValueChange={pick}>
                                <SelectTrigger className="w-full" aria-label="Part of the dialog">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {GROUPS.map((group, index) => (
                                        <SelectGroup key={index}>
                                            {group.label && <SelectLabel>{group.label}</SelectLabel>}
                                            {group.parts.map((part) => (
                                                <SelectItem key={part.id} value={part.id}>
                                                    <PartIcon icon={part.icon} className="size-4" />
                                                    {part.label}
                                                </SelectItem>
                                            ))}
                                        </SelectGroup>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <TabsList
                            aria-label="Parts of the dialog"
                            className="hidden h-auto w-48 shrink-0 flex-col items-stretch justify-start gap-0.5 rounded-none border-r bg-page/60 p-2.5 md:flex"
                        >
                            {GROUPS.map((group, index) => (
                                <Fragment key={index}>
                                    {group.label && (
                                        <p className="px-2.5 pt-3 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase" aria-hidden="true">
                                            {group.label}
                                        </p>
                                    )}
                                    {group.parts.map((part) => (
                                        <TabsTrigger key={part.id} value={part.id} className="h-9 w-full flex-none justify-start gap-2.5 rounded-lg px-2.5">
                                            <PartIcon icon={part.icon} className="size-4" />
                                            <span className="min-w-0 flex-1 truncate text-left">{part.label}</span>
                                        </TabsTrigger>
                                    ))}
                                </Fragment>
                            ))}
                        </TabsList>
                        {/* The height is capped on the viewport, on a phone where the parent has none of its own.
                            From md up the part fills the fixed height beside the list. */}
                        <ScrollArea
                            viewportRef={viewport}
                            className="min-h-0 min-w-0 flex-1 *:data-[slot=scroll-area-viewport]:max-h-[calc(95dvh-15rem)] md:h-full md:*:data-[slot=scroll-area-viewport]:max-h-none [&>[data-slot=scroll-area-viewport]>div]:block!"
                        >
                            {PARTS.map((part) => (
                                <TabsContent key={part.id} value={part.id} className="space-y-5 p-5">
                                    <div className="grid gap-0.5">
                                        <h3 className="font-semibold">{part.label}</h3>
                                        <p className="text-sm text-muted-foreground">{part.description}</p>
                                    </div>
                                    {body(part)}
                                </TabsContent>
                            ))}
                        </ScrollArea>
                    </Tabs>

                    <div className={cn(DIALOG_FOOTER, "flex items-center justify-between gap-3")}>
                        <span className="hidden min-w-0 items-center gap-2 text-xs text-muted-foreground sm:flex">
                            {created ? (
                                "The new key is gone once this dialog closes"
                            ) : (
                                <>
                                    <span className="size-2.5 shrink-0 rounded-[3px] border border-warning bg-warning/15" aria-hidden="true" />
                                    Swap the marked key for one of yours
                                </>
                            )}
                        </span>
                        {/* Nothing to confirm here, so it closes like the other dialogs that only show something. */}
                        <DialogClose asChild>
                            <Button type="button" variant="outline" className="ml-auto">
                                Close
                            </Button>
                        </DialogClose>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
