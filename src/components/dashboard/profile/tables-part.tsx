"use client";

import { saveTableDefaults } from "@/app/actions/auth/table-preferences";
import { Field, PartFrame, SaveBar, usePartSave, usePartValues } from "@/components/dashboard/settings/settings-frame";
import { changesOf } from "@/components/dashboard/settings/settings-values";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PAGE_SIZES, type TableDefaults, type TableDensity } from "@/lib/core/table-preferences";

const DENSITIES: Record<TableDensity, string> = { comfortable: "Comfortable", compact: "Compact" };

const FIELDS = {
    pageSize: { label: "Rows per page", show: (size: number) => String(size) },
    density: { label: "Row height", show: (density: TableDensity) => DENSITIES[density] ?? density },
};

/** The rows per page and the row height every table of the viewer starts with. */
export function TablesPart({ saved }: { saved: TableDefaults }) {
    const form = usePartValues("tables", saved);
    const save = usePartSave("tables");
    const { values, set } = form;

    return (
        <>
            <PartFrame part="tables">
                <div className="grid max-w-xl gap-6 sm:grid-cols-2">
                    <Field label="Rows per page" setting="profile.rows" hint="How many rows a table shows before its next page.">
                        {(id) => (
                            <Select value={String(values.pageSize)} onValueChange={(size) => set("pageSize", Number(size) as TableDefaults["pageSize"])}>
                                <SelectTrigger id={id} className="w-full">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {PAGE_SIZES.map((size) => <SelectItem key={size} value={String(size)}>{size}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        )}
                    </Field>
                    <Field label="Row height" setting="profile.density" hint="Compact fits more rows on the screen.">
                        {(id) => (
                            <Tabs value={values.density} onValueChange={(density) => set("density", density as TableDensity)}>
                                <TabsList id={id} className="h-9">
                                    {(Object.keys(DENSITIES) as TableDensity[]).map((density) => (
                                        <TabsTrigger key={density} value={density} className="px-3">{DENSITIES[density]}</TabsTrigger>
                                    ))}
                                </TabsList>
                            </Tabs>
                        )}
                    </Field>
                </div>
                <p className="text-xs text-muted-foreground">A table you changed in its Columns menu keeps its own rows and height until Reset there.</p>
            </PartFrame>
            <SaveBar
                changes={changesOf(form.base, values, FIELDS)}
                saving={save.saving}
                onDiscard={form.discard}
                onSave={() => save.run(async () => {
                    const result = await saveTableDefaults(values);
                    return result.success ? { success: true } : { success: false, error: result.error || "The defaults could not be saved." };
                }, form.commit)}
            />
        </>
    );
}
