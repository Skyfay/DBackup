"use client";

import { useFormContext } from "react-hook-form";
import { FormControl, FormDescription, FormField, FormItem, FormLabel } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** The Redis database index, 0 to 15, which only picks the default for the connection. */
export function RedisDatabaseSelect() {
    const { control, setValue, getValues } = useFormContext();
    const dbOptions = Array.from({ length: 16 }, (_, i) => i);

    // Ensure default value is set in the form (field may be undefined for new adapters)
    const current = getValues("config.database");
    if (current === undefined || current === null || current === "") {
        setValue("config.database", 0);
    }

    return (
        <FormField
            control={control}
            name="config.database"
            render={({ field }) => {
                const numVal = Number(field.value ?? 0);
                return (
                    <FormItem>
                        <FormLabel>Database</FormLabel>
                        <FormControl>
                            <Select
                                value={`db-${numVal}`}
                                onValueChange={(val) => field.onChange(Number(val.replace("db-", "")))}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {dbOptions.map((db) => (
                                        <SelectItem key={db} value={`db-${db}`}>
                                            {db === 0 ? "Default (0)" : db}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </FormControl>
                        <FormDescription>
                            Redis RDB backups always include all databases (0 to 15). This selects the default database for the connection.
                        </FormDescription>
                    </FormItem>
                );
            }}
        />
    );
}
