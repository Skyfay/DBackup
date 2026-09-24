"use client";

import { useState } from "react";
import { Bell, BellPlus, Plus } from "lucide-react";
import type { NotificationTemplateItem } from "@/components/templates/notification-model";
import { Button } from "@/components/ui/button";
import { PickList, PickTrigger, type PickEntry } from "@/components/ui/pick-list";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getAdapterDefinition } from "@/lib/adapters/definitions";

/** The kind of a channel, like "Slack Webhook". */
export function typeOf(adapterId: string): string | undefined {
    return getAdapterDefinition(adapterId)?.name;
}

export function jobCount(count: number): string {
    return count === 1 ? "1 job" : `${count} jobs`;
}

interface TemplateFieldProps {
    templates: NotificationTemplateItem[];
    loading: boolean;
    picked: string[];
    onPick: (id: string) => void;
    /** Both left out for a viewer who may not write templates. */
    onEdit?: (template: NotificationTemplateItem) => void;
    onCreate?: () => void;
}

/** Adds a template to the job from a list that says what each one sends through and how many jobs use it. */
export function TemplateField({ templates, loading, picked, onPick, onEdit, onCreate }: TemplateFieldProps) {
    const [open, setOpen] = useState(false);
    const available = templates.filter((template) => !picked.includes(template.id));
    const entries: PickEntry[] = available.map((template) => {
        const types = [...new Set(template.channels.map((channel) => typeOf(channel.config.adapterId) ?? channel.config.adapterId))];
        const used = template._count?.jobs ?? 0;
        return {
            id: template.id,
            name: template.name,
            meta: [template.isDefault ? "Default" : null, types.join(", "), used === 0 ? "Not used yet" : `Used by ${jobCount(used)}`].filter(Boolean).join(" · "),
            keywords: [...template.channels.map((channel) => channel.config.name), ...(template.description ? [template.description] : [])],
            // A template that ships with DBackup stays as it is.
            editable: !template.isSystem,
        };
    });

    return (
        <div className="flex min-w-0 gap-2">
            <Popover open={open} onOpenChange={setOpen} modal>
                <PopoverTrigger asChild>
                    <PickTrigger icon={BellPlus} loading={loading} disabled={loading} aria-expanded={open} aria-label="Add a notification template">
                        <span className="truncate text-muted-foreground">{loading ? "Loading..." : "Add a template"}</span>
                    </PickTrigger>
                </PopoverTrigger>
                {/* On the raised surface, so it stands out from the dialog it opens over. */}
                <PopoverContent tone="pick" align="start" className="w-(--radix-popover-trigger-width) min-w-80 overflow-hidden bg-raised p-0">
                    <PickList
                        icon={Bell}
                        title="Pick from Templates"
                        note="Notification templates"
                        groups={[{ entries }]}
                        value={null}
                        emptyText={templates.length === 0 ? "There is no notification template yet." : available.length === 0 ? "Every template is on the job already." : "Nothing matches."}
                        onPick={(id) => {
                            onPick(id);
                            setOpen(false);
                        }}
                        onEdit={
                            onEdit &&
                            ((id) => {
                                const template = templates.find((entry) => entry.id === id);
                                setOpen(false);
                                if (template) onEdit(template);
                            })
                        }
                        createLabel="New template"
                        onCreate={
                            onCreate &&
                            (() => {
                                setOpen(false);
                                onCreate();
                            })
                        }
                        searchPlaceholder="Search by name or channel"
                    />
                </PopoverContent>
            </Popover>
            {onCreate && (
                <Button type="button" variant="outline" onClick={onCreate}>
                    <Plus />
                    New
                </Button>
            )}
        </div>
    );
}
