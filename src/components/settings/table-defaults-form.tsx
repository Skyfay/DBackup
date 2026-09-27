"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { saveTableDefaults } from "@/app/actions/auth/table-preferences";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTableDefaults } from "@/components/ui/table-defaults";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PAGE_SIZES, type TableDefaults, type TableDensity } from "@/lib/core/table-preferences";

/**
 * The rows per page and the row height every table starts with. A table with a Columns menu
 * keeps what the user picks there until its Reset. Each change is saved at once, like the
 * other preferences.
 */
export function TableDefaultsForm() {
    const saved = useTableDefaults();
    const [defaults, setDefaults] = useState<TableDefaults>(saved);
    const [isPending, startTransition] = useTransition();

    const save = (next: TableDefaults) => {
        const previous = defaults;
        setDefaults(next);
        startTransition(async () => {
            try {
                const result = await saveTableDefaults(next);
                if (result.success) {
                    toast.success("Preference saved");
                } else {
                    setDefaults(previous);
                    toast.error(result.error || "Failed to save preference");
                }
            } catch {
                setDefaults(previous);
                toast.error("An error occurred");
            }
        });
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>Tables</CardTitle>
                <CardDescription>
                    How every table starts. A table you change by hand keeps its own rows per page and row height until you reset it in its Columns menu.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex flex-row items-center justify-between gap-4 rounded-lg border p-4">
                    <div className="space-y-0.5">
                        <Label htmlFor="table-page-size" className="text-base font-medium">Rows per page</Label>
                        <p className="text-sm text-muted-foreground">How many rows a table shows before it moves to the next page.</p>
                    </div>
                    <div className="flex items-center gap-2">
                        {isPending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                        <Select value={String(defaults.pageSize)} onValueChange={(value) => save({ ...defaults, pageSize: Number(value) })} disabled={isPending}>
                            <SelectTrigger id="table-page-size" className="w-24">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {PAGE_SIZES.map((size) => <SelectItem key={size} value={String(size)}>{size}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                </div>
                <div className="flex flex-row items-center justify-between gap-4 rounded-lg border p-4">
                    <div className="space-y-0.5">
                        <p id="table-density" className="text-base font-medium">Row height</p>
                        <p className="text-sm text-muted-foreground">Compact fits more rows on the screen.</p>
                    </div>
                    <Tabs value={defaults.density} onValueChange={(value) => save({ ...defaults, density: value as TableDensity })}>
                        <TabsList className="h-8" aria-labelledby="table-density">
                            <TabsTrigger value="comfortable" className="px-2.5 text-xs" disabled={isPending}>Comfortable</TabsTrigger>
                            <TabsTrigger value="compact" className="px-2.5 text-xs" disabled={isPending}>Compact</TabsTrigger>
                        </TabsList>
                    </Tabs>
                </div>
            </CardContent>
        </Card>
    );
}
