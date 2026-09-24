"use client";

import { Check, ChevronsUpDown, Loader2, Pencil, Plus, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";

/** One saved entry a field can pick. */
export interface PickEntry {
    id: string;
    name: string;
    /** What the entry is and where it is in use, joined with a middle dot. */
    meta: string;
    /** More words the search finds it by, like its description. */
    keywords?: string[];
    /** Its own picture for the tile, like the logo of a connection's type. The list's icon otherwise. */
    icon?: React.ReactNode;
    /** False for an entry nobody edits, like a policy that ships with DBackup. */
    editable?: boolean;
}

export interface PickGroup {
    /** Left out when the list has a single group. */
    heading?: string;
    entries: PickEntry[];
}

interface PickRowProps {
    entry: PickEntry;
    icon: LucideIcon;
    picked: boolean;
    onPick: (id: string) => void;
    onEdit?: (id: string) => void;
}

function PickRow({ entry, icon: Icon, picked, onPick, onEdit }: PickRowProps) {
    return (
        <CommandItem value={entry.name} keywords={entry.keywords} onSelect={() => onPick(entry.id)} className="group gap-3 px-2 py-2">
            <span
                className={cn("flex size-8 shrink-0 items-center justify-center rounded-md border", picked ? "border-tone/30 bg-tone/12" : "bg-muted")}
                aria-hidden="true"
            >
                {entry.icon ?? <Icon className={cn("size-3.5", picked ? "text-tone" : "text-muted-foreground")} />}
            </span>
            <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="truncate font-medium">{entry.name}</span>
                <span className="truncate text-xs text-muted-foreground">{entry.meta}</span>
            </span>
            {picked && (
                <>
                    <Check className="size-4 text-tone" aria-hidden="true" />
                    <span className="sr-only">Picked</span>
                </>
            )}
            {/* Shown on hover from md up, always on a phone, which has none. The row picks on a
                click and on Enter, so the button keeps both to itself. */}
            {onEdit && entry.editable !== false && (
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 shrink-0 gap-1 px-2 text-xs md:opacity-0 md:group-hover:opacity-100 md:group-data-[selected=true]:opacity-100 md:focus-visible:opacity-100"
                    onClick={(event) => {
                        event.stopPropagation();
                        onEdit(entry.id);
                    }}
                    onKeyDown={(event) => event.stopPropagation()}
                    aria-label={`Edit ${entry.name}`}
                >
                    <Pencil className="size-3" />
                    Edit
                </Button>
            )}
        </CommandItem>
    );
}

interface PickListProps {
    icon: LucideIcon;
    /** Where the entries come from, like "Pick from the Vault". */
    title: string;
    /** What kind of entry the field takes, like "User and password". */
    note: string;
    groups: PickGroup[];
    value: string | null | undefined;
    /** Shown when the search finds nothing, or nothing is saved yet. */
    emptyText: string;
    onPick: (id: string) => void;
    onEdit?: (id: string) => void;
    /** Names the button at the foot that adds an entry, like "New login". */
    createLabel: string;
    onCreate: () => void;
    /** Beside it, Use none or a note on why there is none. */
    aside?: React.ReactNode;
    searchPlaceholder?: string;
}

/**
 * The saved entries a field picks from, headed in the turquoise of picking. Every row says what
 * the entry is and where it is in use, Edit sits on the row, and the foot adds a new one. It
 * goes into a `PopoverContent tone="pick"` opened by a `PickTrigger`.
 */
export function PickList({
    icon,
    title,
    note,
    groups,
    value,
    emptyText,
    onPick,
    onEdit,
    createLabel,
    onCreate,
    aside,
    searchPlaceholder = "Search by name or description",
}: PickListProps) {
    return (
        <>
            <DialogHead tone="pick" icon={icon} className="px-3.5 py-3">
                <p className="text-sm font-semibold">{title}</p>
                <p className={dialogNoteClass("pick")}>{note}</p>
            </DialogHead>
            <Command>
                <CommandInput placeholder={searchPlaceholder} />
                <CommandList>
                    <CommandEmpty className="px-4 py-6 text-center text-sm text-muted-foreground">{emptyText}</CommandEmpty>
                    {groups
                        .filter((group) => group.entries.length > 0)
                        .map((group, index) => (
                            <CommandGroup key={group.heading ?? index} heading={group.heading}>
                                {group.entries.map((entry) => (
                                    <PickRow key={entry.id} entry={entry} icon={icon} picked={entry.id === value} onPick={onPick} onEdit={onEdit} />
                                ))}
                            </CommandGroup>
                        ))}
                </CommandList>
            </Command>
            {/* Outline buttons like every other secondary action, so they read as buttons on the strip. */}
            <div className="flex min-h-12 items-center justify-between gap-3 border-t bg-page/60 px-3 py-2">
                <Button type="button" variant="outline" size="sm" onClick={onCreate}>
                    <Plus />
                    {createLabel}
                </Button>
                {aside}
            </div>
        </>
    );
}

interface PickTriggerProps extends React.ComponentProps<typeof Button> {
    icon: LucideIcon;
    /** Takes the place of the icon, like the logo of the picked connection. */
    leading?: React.ReactNode;
    loading?: boolean;
}

/**
 * The button of a field that picks a saved entry, with the entry's icon, its name or a
 * placeholder, and a focus ring in the tone of the dialog around it.
 */
export function PickTrigger({ icon: Icon, leading, loading = false, className, children, ...props }: PickTriggerProps) {
    return (
        <Button
            type="button"
            variant="outline"
            role="combobox"
            className={cn("min-w-0 flex-1 justify-between font-normal focus-visible:border-tone-ring focus-visible:ring-tone-ring/50", className)}
            {...props}
        >
            <span className="flex min-w-0 items-center gap-2">
                {loading ? (
                    <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
                ) : (
                    (leading ?? <Icon className="size-4 shrink-0 text-muted-foreground" />)
                )}
                {children}
            </span>
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
    );
}
