"use client";

import Link from "next/link";
import { useFieldArray, useFormContext, type FieldError } from "react-hook-form";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { ChoiceCards } from "@/components/adapter/connection-mode-choice";
import { DatabaseChecklist } from "@/components/adapter/database-checklist";
import { Button } from "@/components/ui/button";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { isCombinableWithDirectories } from "@/lib/adapters/combinable";
import { ConnectionPicker } from "./connection-picker";
import type { DirectoryTreeRow } from "./directory-tree";
import { FolderRow } from "./job-folder-row";
import type { AdapterOption, DirectorySourceValue, JobFormValues } from "./job-form-schema";
import { ListMessage } from "./job-part-destinations";

/** Sources that back up as a whole, so there is nothing to pick from. */
const WHOLE_SOURCES = ["sqlite", "redis", "valkey"];

const MODES = [
    { value: "db", title: "A database", description: "A database server, with all or some of its databases." },
    { value: "dirs", title: "Folders", description: "Files from storage connections set up as directory sources." },
    { value: "both", title: "Both", description: "A database and folders together in one backup." },
];

const SCOPES = [
    { value: "all", title: "All databases", description: "Also the ones added later." },
    { value: "some", title: "Some databases", description: "Pick them from the server." },
];

interface SourcePartProps {
    sources: AdapterOption[];
    folderOptions: AdapterOption[];
    defaultExcludePresetIds: string[];
}

/** A database, folders from storage connections, or both. */
export function SourcePart({ sources, folderOptions, defaultExcludePresetIds }: SourcePartProps) {
    const form = useFormContext<JobFormValues>();
    const folders = useFieldArray({ control: form.control, name: "directorySources" });
    const mode = form.watch("sourceMode");
    const sourceId = form.watch("sourceId");
    const scope = form.watch("databaseScope");
    const source = sources.find((option) => option.id === sourceId);
    // Only a database that can be dumped one by one goes into a backup together with folders.
    const databaseOptions = mode === "both" ? sources.filter((option) => isCombinableWithDirectories(option.adapterId)) : sources;

    const changeMode = (next: string) => {
        const value = next as JobFormValues["sourceMode"];
        // What a mode leaves out is cleared, so a half filled row it hides cannot stop the save.
        if (value === "db") folders.replace([]);
        if (value === "dirs") {
            form.setValue("sourceId", "");
            form.setValue("databases", []);
        }
        if (value === "both" && source && !isCombinableWithDirectories(source.adapterId)) {
            form.setValue("sourceId", "");
            form.setValue("databases", []);
            toast.info(`${source.name} cannot go into one backup with folders. Pick another database.`);
        }
        form.setValue("sourceMode", value, { shouldValidate: form.formState.isSubmitted });
    };

    /** Every folder of one connection becomes what the picker returned, the folders of other connections stay. */
    const syncFolders = (configId: string, rows: DirectoryTreeRow[]) => {
        const current = form.getValues("directorySources");
        const remaining = [...rows];
        const result: DirectorySourceValue[] = [];
        for (const entry of current) {
            if (entry.configId !== configId) {
                result.push(entry);
                continue;
            }
            const match = remaining.findIndex((row) => row.path === entry.path);
            if (match === -1) continue;
            const [row] = remaining.splice(match, 1);
            result.push({ ...entry, excludePatterns: row.excludePatterns });
        }
        for (const row of remaining) {
            result.push({ configId, path: row.path, excludePatterns: row.excludePatterns, excludePatternPresetIds: defaultExcludePresetIds, stopContainers: true });
        }
        folders.replace(result);
    };

    return (
        <>
            <FormField
                control={form.control}
                name="sourceMode"
                render={({ field }) => (
                    <FormItem>
                        <FormControl>
                            <ChoiceCards value={field.value} onValueChange={changeMode} options={MODES} aria-label="What goes in" className="grid gap-2.5 sm:grid-cols-3" />
                        </FormControl>
                    </FormItem>
                )}
            />

            {mode !== "dirs" && (
                <div className="space-y-4">
                    <FormField
                        control={form.control}
                        name="sourceId"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Database</FormLabel>
                                <FormControl>
                                    <ConnectionPicker
                                        options={databaseOptions}
                                        value={field.value}
                                        onChange={(id) => {
                                            if (id !== field.value) form.setValue("databases", []);
                                            field.onChange(id);
                                        }}
                                        placeholder="Pick a database connection"
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    {source && WHOLE_SOURCES.includes(source.adapterId) && (
                        <p className="text-sm text-muted-foreground">{source.name} is backed up as a whole, there are no databases to pick.</p>
                    )}
                    {source && !WHOLE_SOURCES.includes(source.adapterId) && (
                        <>
                            <FormField
                                control={form.control}
                                name="databaseScope"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormControl>
                                            <ChoiceCards
                                                value={field.value}
                                                onValueChange={(next) => {
                                                    if (next === "all") form.setValue("databases", []);
                                                    field.onChange(next);
                                                }}
                                                options={SCOPES}
                                                aria-label="Which databases"
                                            />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                            {scope === "some" && (
                                <FormField
                                    control={form.control}
                                    name="databases"
                                    render={({ field }) => (
                                        <FormItem>
                                            <DatabaseChecklist sourceId={source.id} value={field.value} onChange={field.onChange} />
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            )}
                        </>
                    )}
                </div>
            )}

            {mode !== "db" && (
                <FormField
                    control={form.control}
                    name="directorySources"
                    render={() => (
                        <FormItem className="space-y-3">
                            <div className="flex items-center justify-between gap-3">
                                <FormLabel>Folders</FormLabel>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={folderOptions.length === 0}
                                    onClick={() => folders.append({ configId: "", path: "", excludePatterns: [], excludePatternPresetIds: defaultExcludePresetIds, stopContainers: true })}
                                >
                                    <Plus />
                                    Add folder
                                </Button>
                            </div>
                            {folders.fields.map((field, index) => (
                                <FolderRow key={field.id} index={index} options={folderOptions} onRemove={() => folders.remove(index)} onSync={syncFolders} />
                            ))}
                            {folderOptions.length === 0 ? (
                                <p className="text-sm text-muted-foreground">
                                    No storage connection is set up as a directory source yet. Add one on the{" "}
                                    <Link href="/dashboard/connections?tab=directory-sources" className="font-medium text-foreground hover:underline hover:underline-offset-4">
                                        Connections page
                                    </Link>
                                    .
                                </p>
                            ) : (
                                folders.fields.length === 0 && <p className="text-sm text-muted-foreground">No folder yet. Add one, then type its path or browse for it.</p>
                            )}
                            <ListMessage error={form.formState.errors.directorySources as (FieldError & { root?: FieldError }) | undefined} />
                        </FormItem>
                    )}
                />
            )}
        </>
    );
}
