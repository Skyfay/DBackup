"use client";

import { Check, type LucideIcon } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { SectionLayout, SectionStatus } from "./connection-form-layout";

export interface NavSection extends SectionLayout {
    icon: LucideIcon;
}

/** Done, still to fill in, or how many fields need attention. Screen readers hear it as words. */
function StatusMark({ status }: { status: SectionStatus | undefined }) {
    if (!status || status.kind === "none") return null;
    if (status.kind === "done") {
        return (
            <>
                <Check className="size-3.5 text-success" strokeWidth={2.5} aria-hidden="true" />
                <span className="sr-only">, done</span>
            </>
        );
    }
    if (status.kind === "todo") {
        return (
            <>
                <span className="inline-block size-2 shrink-0 rounded-full border-[1.5px] border-muted-foreground/60" aria-hidden="true" />
                <span className="sr-only">, still to fill in</span>
            </>
        );
    }
    return (
        <>
            <span className="rounded-full bg-destructive/12 px-1.5 text-[11px] leading-[1.125rem] font-semibold tabular-nums text-destructive" aria-hidden="true">
                {status.count}
            </span>
            <span className="sr-only">, {status.count === 1 ? "1 field needs attention" : `${status.count} fields need attention`}</span>
        </>
    );
}

/**
 * The parts of the form as a list on the left. It lives inside the form's Tabs, so the arrow
 * keys move through it and each entry controls its part.
 */
export function SectionRail({ sections, statuses }: { sections: NavSection[]; statuses: Record<string, SectionStatus> }) {
    return (
        <TabsList
            aria-label="Parts of the form"
            className="hidden h-auto w-48 shrink-0 flex-col items-stretch justify-start gap-0.5 rounded-none border-r bg-page/60 p-2.5 md:flex"
        >
            {sections.map((section) => {
                const Icon = section.icon;
                return (
                    <TabsTrigger key={section.id} value={section.id} className="h-9 w-full flex-none justify-start gap-2.5 rounded-lg px-2.5">
                        <Icon aria-hidden="true" />
                        <span className="min-w-0 flex-1 truncate text-left">{section.label}</span>
                        <StatusMark status={statuses[section.id]} />
                    </TabsTrigger>
                );
            })}
        </TabsList>
    );
}

/** The same parts as a menu, for a phone, which has no room for the list beside the fields. */
export function SectionSelect({
    sections,
    statuses,
    value,
    onValueChange,
}: {
    sections: NavSection[];
    statuses: Record<string, SectionStatus>;
    value: string;
    onValueChange: (value: string) => void;
}) {
    return (
        <div className="border-b px-5 py-3 md:hidden">
            <Select value={value} onValueChange={onValueChange}>
                <SelectTrigger className="w-full" aria-label="Part of the form">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {sections.map((section) => (
                        <SelectItem key={section.id} value={section.id}>
                            <span className="flex items-center gap-2">
                                {section.label}
                                <StatusMark status={statuses[section.id]} />
                            </span>
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    );
}
