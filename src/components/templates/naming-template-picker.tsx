"use client";

import { useState } from "react";
import { FileText, Plus } from "lucide-react";
import type { NamingTemplate } from "@prisma/client";
import { useCan } from "@/components/permissions/permissions-context";
import { NamingTemplateDialog } from "@/components/settings/templates/naming-template-dialog";
import { Button } from "@/components/ui/button";
import { PickList, PickTrigger, type PickEntry } from "@/components/ui/pick-list";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PERMISSIONS } from "@/lib/auth/permissions";
import type { ListedNamingTemplate } from "./use-naming-templates";

const DEFAULT = "__DEFAULT__";

function usage(template: ListedNamingTemplate): string {
    const count = template._count?.jobs ?? 0;
    if (count === 0) return "Not used yet";
    return count === 1 ? "Used by 1 job" : `Used by ${count} jobs`;
}

interface NamingTemplatePickerProps extends Omit<React.ComponentProps<typeof Button>, "value" | "onChange"> {
    templates: ListedNamingTemplate[];
    loading: boolean;
    /** The template of the job, or null to follow whichever template is the default. */
    value: string | null;
    onChange: (id: string | null) => void;
    /** Puts a template made or changed from here into the list. */
    onSaved: (template: NamingTemplate) => void;
}

/**
 * Picks the naming template of a job, like the login field of a connection: the default template
 * first, which follows whichever one is marked as the default, then the templates with their
 * pattern and how many jobs use them. Edit and New are there for a viewer who may write templates.
 */
export function NamingTemplatePicker({ templates, loading, value, onChange, onSaved, className, ...props }: NamingTemplatePickerProps) {
    const [open, setOpen] = useState(false);
    const [dialog, setDialog] = useState<{ open: boolean; template?: NamingTemplate }>({ open: false });
    const canWrite = useCan(PERMISSIONS.TEMPLATES.WRITE);
    const defaultTemplate = templates.find((template) => template.isDefault);
    const selected = templates.find((template) => template.id === value);

    const special: PickEntry = {
        id: DEFAULT,
        name: "Default template",
        meta: defaultTemplate ? `Follows the template marked as the default, now ${defaultTemplate.name}` : "No template is the default, so the built-in pattern is used",
        editable: false,
    };
    const entries: PickEntry[] = templates.map((template) => ({
        id: template.id,
        name: template.name,
        meta: [template.isDefault ? "Default" : null, template.pattern, usage(template)].filter(Boolean).join(" · "),
        keywords: [template.pattern, ...(template.description ? [template.description] : [])],
        // A template that ships with DBackup stays as it is.
        editable: !template.isSystem,
    }));

    const openDialog = (template?: NamingTemplate) => {
        setOpen(false);
        setDialog({ open: true, template });
    };

    return (
        <div className={className ? `flex min-w-0 gap-2 ${className}` : "flex min-w-0 gap-2"}>
            <Popover open={open} onOpenChange={setOpen} modal>
                <PopoverTrigger asChild>
                    <PickTrigger icon={FileText} loading={loading} disabled={loading} aria-expanded={open} {...props}>
                        {loading ? (
                            <span className="text-muted-foreground">Loading...</span>
                        ) : selected ? (
                            <>
                                <span className="truncate">{selected.name}</span>
                                <span className="hidden truncate font-mono text-xs text-muted-foreground sm:inline">{selected.pattern}</span>
                            </>
                        ) : (
                            <>
                                <span className="shrink-0">Default template</span>
                                {defaultTemplate && <span className="truncate text-xs text-muted-foreground">{defaultTemplate.name}</span>}
                            </>
                        )}
                    </PickTrigger>
                </PopoverTrigger>
                {/* On the raised surface, so it stands out from the dialog it opens over. */}
                <PopoverContent tone="pick" align="start" className="w-(--radix-popover-trigger-width) min-w-80 overflow-hidden bg-raised p-0">
                    <PickList
                        icon={FileText}
                        title="Pick from Templates"
                        note="Naming templates"
                        groups={[{ entries: [special] }, { heading: "Templates", entries }]}
                        value={value ?? DEFAULT}
                        emptyText="Nothing matches."
                        onPick={(id) => {
                            onChange(id === DEFAULT ? null : id);
                            setOpen(false);
                        }}
                        onEdit={canWrite ? (id) => openDialog(templates.find((template) => template.id === id)) : undefined}
                        createLabel="New template"
                        onCreate={canWrite ? () => openDialog() : undefined}
                        searchPlaceholder="Search by name or pattern"
                    />
                </PopoverContent>
            </Popover>
            {canWrite && (
                <Button type="button" variant="outline" onClick={() => openDialog()}>
                    <Plus />
                    New
                </Button>
            )}

            <NamingTemplateDialog
                open={dialog.open}
                onOpenChange={(next) => setDialog((current) => ({ ...current, open: next }))}
                template={dialog.template}
                onSuccess={(template) => {
                    onSaved(template);
                    // A new template is picked right away, an edited one only refreshes what the field shows.
                    if (!dialog.template) onChange(template.id);
                    setDialog((current) => ({ ...current, open: false }));
                }}
            />
        </div>
    );
}
