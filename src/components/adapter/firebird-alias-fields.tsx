import { useFieldArray, useFormContext } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField, FormItem, FormControl, FormMessage } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import { Plus, Trash2 } from "lucide-react";

/**
 * Repeatable alias + path list for the Firebird source form.
 *
 * Firebird has no server-side "list databases" command, so the admin enters
 * the alias/path pairs once here. Everything else (job database picker,
 * runner pipeline, restore UI) consumes these names via getDatabases() like
 * any other adapter - see src/lib/adapters/database/firebird/connection.ts.
 */
export function FirebirdAliasFields({ showIntro = true }: {
    /** False where a heading around the list already explains it. */
    showIntro?: boolean;
} = {}) {
    const { control, getFieldState, formState } = useFormContext();
    const { fields, append, remove } = useFieldArray({
        control,
        name: "config.databases",
    });
    // An empty list has no row to carry its error, so the list shows it itself.
    const listError = getFieldState("config.databases", formState).error;
    const listMessage = listError?.message ?? listError?.root?.message;

    return (
        <div className="space-y-3">
            {showIntro && (
                <div className="space-y-1">
                    <Label>Database Aliases</Label>
                    <p className="text-sm text-muted-foreground">
                        Firebird cannot list databases automatically - enter the alias and path (as seen by the Firebird server) for each database to back up.
                    </p>
                </div>
            )}

            <div className="space-y-2">
                {fields.map((field, index) => (
                    <div key={field.id} className="flex items-start gap-2">
                        <FormField
                            control={control}
                            name={`config.databases.${index}.name`}
                            render={({ field: nameField }) => (
                                <FormItem className="flex-1">
                                    <FormControl>
                                        <Input placeholder="Alias (e.g. erp)" {...nameField} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={control}
                            name={`config.databases.${index}.path`}
                            render={({ field: pathField }) => (
                                <FormItem className="flex-1">
                                    <FormControl>
                                        <Input placeholder="/data/erp.fdb" className="font-mono text-sm" {...pathField} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => remove(index)}
                            disabled={fields.length <= 1}
                            title="Remove database"
                        >
                            <Trash2 className="h-4 w-4" />
                        </Button>
                    </div>
                ))}
            </div>

            {listMessage && <p className="text-sm text-destructive">{listMessage}</p>}

            <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => append({ name: "", path: "" })}
            >
                <Plus className="mr-2 h-4 w-4" />
                Add Database
            </Button>
        </div>
    );
}
