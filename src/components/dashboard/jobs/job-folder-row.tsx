"use client";

import { useState } from "react";
import { useFormContext } from "react-hook-form";
import { ChevronDown, Filter, FolderOpen, HardDrive, Trash2 } from "lucide-react";
import { ExcludePatternPresetPicker } from "@/components/templates/exclude-pattern-preset-picker";
import { Button } from "@/components/ui/button";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ADAPTER_DEFINITIONS } from "@/lib/adapters/definitions";
import { cn } from "@/lib/utils";
import { ConnectionPicker } from "./connection-picker";
import { DirectoryBrowseDialog } from "./directory-browse-dialog";
import type { DirectoryTreeRow } from "./directory-tree";
import type { AdapterOption, JobFormValues } from "./job-form-schema";

interface FolderRowProps {
    index: number;
    options: AdapterOption[];
    onRemove: () => void;
    /** Sets every folder of one connection to what the folder picker returned. */
    onSync: (configId: string, rows: DirectoryTreeRow[]) => void;
}

/** One folder of a storage connection, with what it leaves out. */
export function FolderRow({ index, options, onRemove, onSync }: FolderRowProps) {
    const form = useFormContext<JobFormValues>();
    const [open, setOpen] = useState(false);
    const [browsing, setBrowsing] = useState(false);
    const configId = form.watch(`directorySources.${index}.configId`);
    const patterns = form.watch(`directorySources.${index}.excludePatterns`);
    const presetIds = form.watch(`directorySources.${index}.excludePatternPresetIds`);
    const connection = options.find((option) => option.id === configId);
    const definition = ADAPTER_DEFINITIONS.find((entry) => entry.id === connection?.adapterId);
    // How the connection lists what it holds is declared on its definition, not guessed from its id.
    const flat = definition?.flatBrowse === true;
    const noun = definition?.browseNoun ?? "folder";
    const excludes = patterns.length + presetIds.length;
    const setPresets = (next: string[]) => form.setValue(`directorySources.${index}.excludePatternPresetIds`, next, { shouldDirty: true });

    return (
        <div className="rounded-lg border">
            <div className="flex flex-wrap items-start gap-2 p-3 sm:flex-nowrap">
                <FormField
                    control={form.control}
                    name={`directorySources.${index}.configId`}
                    render={({ field }) => (
                        <FormItem className="w-full min-w-0 sm:w-52 sm:shrink-0">
                            <FormControl>
                                <ConnectionPicker kind="directory" options={options} value={field.value} onChange={field.onChange} placeholder="Pick a connection" aria-label="Connection" />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                <FormField
                    control={form.control}
                    name={`directorySources.${index}.path`}
                    render={({ field }) => (
                        <FormItem className="min-w-0 flex-1">
                            <FormControl>
                                <Input placeholder={flat ? `${noun}-name` : "/path/to/folder"} aria-label="Path" autoComplete="off" spellCheck={false} {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                <Button
                    type="button"
                    variant="outline"
                    className="size-9 shrink-0 p-0"
                    disabled={!connection?.supportsBrowse}
                    onClick={() => setBrowsing(true)}
                    aria-label={flat ? `Pick ${noun}s` : "Browse folders"}
                    title={connection?.supportsBrowse ? undefined : "Pick a connection that can be browsed first"}
                >
                    {flat ? <HardDrive /> : <FolderOpen />}
                </Button>
                <Button type="button" variant="ghost" className="h-9 shrink-0 gap-1 px-2" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="What it leaves out">
                    <Filter />
                    {excludes > 0 && <span className="text-xs tabular-nums">{excludes}</span>}
                    <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
                </Button>
                <Button type="button" variant="ghost" className="size-9 shrink-0 p-0 text-muted-foreground hover:text-destructive" onClick={onRemove} aria-label="Remove folder">
                    <Trash2 />
                </Button>
            </div>

            {open && (
                <div className="space-y-3 border-t bg-muted/30 p-3">
                    {connection?.adapterId === "docker-volume" && (
                        <FormField
                            control={form.control}
                            name={`directorySources.${index}.stopContainers`}
                            render={({ field }) => (
                                <FormItem className="flex items-start gap-4 rounded-md border bg-background p-3">
                                    <div className="grid min-w-0 flex-1 gap-0.5">
                                        <FormLabel>Stop containers while reading</FormLabel>
                                        <p className="text-xs text-muted-foreground">
                                            The containers using this volume stop while it is read, then start again. Without it, a volume read
                                            while it is written is only as consistent as after a power cut.
                                        </p>
                                    </div>
                                    <FormControl>
                                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                    )}
                    <p className="text-xs font-medium text-muted-foreground">Leaves out</p>
                    {presetIds.map((presetId, position) => (
                        <div key={presetId} className="flex items-center gap-2">
                            <div className="min-w-0 flex-1">
                                <ExcludePatternPresetPicker
                                    value={presetId}
                                    onChange={(id) => id && setPresets(presetIds.map((current, at) => (at === position ? id : current)))}
                                    usedIds={presetIds.filter((_, at) => at !== position)}
                                />
                            </div>
                            <Button type="button" variant="ghost" className="size-8 shrink-0 p-0 text-muted-foreground hover:text-destructive" onClick={() => setPresets(presetIds.filter((_, at) => at !== position))} aria-label="Remove preset">
                                <Trash2 />
                            </Button>
                        </div>
                    ))}
                    <ExcludePatternPresetPicker value={null} onChange={(id) => id && !presetIds.includes(id) && setPresets([...presetIds, id])} placeholder="Add an exclude preset" usedIds={presetIds} />
                    <Textarea
                        rows={3}
                        aria-label="Exclude patterns"
                        placeholder={"*.tmp\nnode_modules/**\n.cache/**"}
                        value={patterns.join("\n")}
                        onChange={(event) =>
                            form.setValue(`directorySources.${index}.excludePatterns`, event.target.value.split("\n").map((line) => line.trim()).filter(Boolean), { shouldDirty: true })
                        }
                    />
                    <p className="text-xs text-muted-foreground">One pattern per line. Files and folders that match one are skipped.</p>
                </div>
            )}

            {connection?.supportsBrowse && (
                <DirectoryBrowseDialog
                    open={browsing}
                    onOpenChange={setBrowsing}
                    configId={connection.id}
                    connectionName={connection.name}
                    initialRows={form
                        .getValues("directorySources")
                        .filter((source) => source.configId === connection.id)
                        .map((source) => ({ path: source.path, excludePatterns: source.excludePatterns, excludePatternPresetIds: source.excludePatternPresetIds }))}
                    onConfirm={(rows) => onSync(connection.id, rows)}
                    flat={flat}
                    itemNoun={noun}
                />
            )}
        </div>
    );
}
