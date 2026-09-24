"use client";

import { useFormContext, type FieldError, type UseFieldArrayReturn } from "react-hook-form";
import { Info, Plus, X } from "lucide-react";
import { RetentionPolicyPicker } from "@/components/templates/retention-policy-picker";
import { Button } from "@/components/ui/button";
import { FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { ConnectionPicker } from "./connection-picker";
import { emptyDestination, type AdapterOption, type JobFormValues } from "./job-form-schema";

/**
 * The error of a whole list, like "Add at least one destination". A list keeps it under `root`
 * when its rows have errors of their own, and on itself otherwise.
 */
export function ListMessage({ error }: { error: (FieldError & { root?: FieldError }) | undefined }) {
    const message = error?.root?.message ?? error?.message;
    return message ? <p className="text-sm text-destructive">{message}</p> : null;
}

export type DestinationArray = UseFieldArrayReturn<JobFormValues, "destinations">;

/** Adds a destination, for the head of the part. A row can also add a new connection, so it never runs out. */
export function AddDestinationButton({ array }: { array: DestinationArray }) {
    return (
        <Button type="button" variant="outline" size="sm" onClick={() => array.append(emptyDestination())}>
            <Plus />
            Add destination
        </Button>
    );
}

/** Where the backups go, in upload order, each with what it keeps. */
export function DestinationsPart({ options, array }: { options: AdapterOption[]; array: DestinationArray }) {
    const form = useFormContext<JobFormValues>();
    const { fields, remove } = array;
    const rows = form.watch("destinations");
    const incremental = form.watch("backupMode") === "INCREMENTAL" && form.watch("sourceMode") !== "db";
    const taken = rows.map((row) => row.configId).filter(Boolean);

    return (
        <>
            <div className="space-y-2.5">
                {fields.map((field, index) => (
                    <div key={field.id} className="flex flex-wrap items-start gap-2 rounded-lg border p-3 sm:flex-nowrap">
                        <span className="flex size-9 shrink-0 items-center justify-center text-sm text-muted-foreground tabular-nums" aria-hidden="true">
                            {index + 1}
                        </span>
                        <FormField
                            control={form.control}
                            name={`destinations.${index}.configId`}
                            render={({ field: picker }) => (
                                <FormItem className="min-w-0 flex-1">
                                    <FormControl>
                                        <ConnectionPicker
                                            kind="destination"
                                            options={options}
                                            value={picker.value}
                                            onChange={picker.onChange}
                                            taken={taken}
                                            placeholder="Pick a destination"
                                            aria-label={`Destination ${index + 1}`}
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <div className="w-full min-w-0 sm:w-64 sm:shrink-0">
                            <RetentionPolicyPicker
                                value={rows[index]?.retentionPolicyId ?? null}
                                onChange={(id) => form.setValue(`destinations.${index}.retentionPolicyId`, id ?? undefined, { shouldDirty: true })}
                                allowDefault
                                placeholder="No policy, keeps all"
                                aria-label={`Retention of destination ${index + 1}`}
                            />
                        </div>
                        <Button
                            type="button"
                            variant="ghost"
                            className="size-9 shrink-0 p-0 text-muted-foreground hover:text-destructive"
                            disabled={fields.length === 1}
                            onClick={() => remove(index)}
                            aria-label={`Remove destination ${index + 1}`}
                        >
                            <X />
                        </Button>
                    </div>
                ))}
                <ListMessage error={form.formState.errors.destinations as (FieldError & { root?: FieldError }) | undefined} />
            </div>

            <ul className="grid gap-2.5 text-sm text-muted-foreground">
                <li className="flex gap-3">
                    <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    When one destination fails, the others still get their copy and the run ends as Partial.
                </li>
                {incremental && (
                    <li className="flex gap-3">
                        <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                        The job is incremental, so a chain is only deleted once its newest backup expires. A destination holds more backups than
                        its policy alone would keep for a while, the retention log names them.
                    </li>
                )}
            </ul>
        </>
    );
}
