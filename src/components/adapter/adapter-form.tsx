
"use client";

import { useState, useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { ChevronsUpDown, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";

import { AdapterDefinition } from "@/lib/adapters/definitions";
import { AdapterConfig } from "./types";
import { useAdapterConnection } from "./use-adapter-connection";
import { DatabaseFormContent, GenericFormContent, NotificationFormContent, StorageFormContent } from "./form-sections";
import { SchemaField } from "./schema-field";

export function AdapterForm({ type, adapters, onSuccess, initialData, onBack }: { type: string, adapters: AdapterDefinition[], onSuccess: () => void, initialData?: AdapterConfig, onBack?: () => void }) {
    const [selectedAdapterId, setSelectedAdapterId] = useState<string>(initialData?.adapterId || "");

    const selectedAdapter = adapters.find(a => a.id === selectedAdapterId);

    // Group adapters by their group field (preserves insertion order)
    const adapterGroups = useMemo(() => {
        const groups: { label: string; items: AdapterDefinition[] }[] = [];
        const seen = new Map<string, AdapterDefinition[]>();
        for (const adapter of adapters) {
            const key = adapter.group ?? "";
            if (!seen.has(key)) {
                const items: AdapterDefinition[] = [];
                seen.set(key, items);
                groups.push({ label: key, items });
            }
            seen.get(key)!.push(adapter);
        }
        return groups;
    }, [adapters]);

    const hasGroups = adapterGroups.some(g => g.label !== "");

    // Initial load of databases if editing
    useEffect(() => {
        if(initialData && type === 'database') {
             // We don't automatically load DB list on edit to avoid slow requests
        }
    }, [initialData, type]);

    const schema = z.object({
        name: z.string().min(1, "Name is required"),
        adapterId: z.string().min(1, "Type is required"),
        config: selectedAdapter ? selectedAdapter.configSchema : z.any()
    });

    const form = useForm({
        resolver: zodResolver(schema),
        defaultValues: {
            name: initialData?.name || "",
            adapterId: initialData?.adapterId || (adapters.length === 1 ? adapters[0].id : ""),
            config: initialData ? JSON.parse(initialData.config) : {}
        }
    });

    const {
        connectionError,
        setConnectionError,
        pendingSubmission,
        setPendingSubmission,
        detectedVersion,
        availableDatabases,
        isLoadingDbs,
        isDbListOpen,
        setIsDbListOpen,
        testConnection,
        fetchDatabases
    } = useAdapterConnection({
        adapterId: selectedAdapterId,
        form,
        initialDataId: initialData?.id
    });

    // Update form schema/values when adapter changes
    useEffect(() => {
        if (!initialData && adapters.length === 1) {
            const firstId = adapters[0].id;
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setSelectedAdapterId(firstId);
            form.setValue("adapterId", firstId);
        }
    }, [adapters, initialData, form]);


    const saveConfig = async (data: any) => {
        try {
            const url = initialData ? `/api/adapters/${initialData.id}` : '/api/adapters';
            const method = initialData ? 'PUT' : 'POST';

            const payload = {
                ...data, // name, adapterId
                config: data.config,
                type: type // ensure type is sent
            };

            const res = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                toast.success(initialData ? "Updated successfully" : "Created successfully");
                onSuccess();
            } else {
                toast.error("Operation failed");
            }
        } catch (_error) {
            toast.error("An error occurred");
        }
    };

    const onSubmit = async (data: any) => {
        if (type === 'database') {
             const toastId = toast.loading("Testing connection...");
             try {
                 const testRes = await fetch('/api/adapters/test-connection', {
                     method: 'POST',
                     headers: { 'Content-Type': 'application/json' },
                     body: JSON.stringify({ adapterId: data.adapterId, config: data.config })
                 });

                 const testResult = await testRes.json();

                 toast.dismiss(toastId);

                 if (testResult.success) {
                     toast.success("Connection test successful");
                     await saveConfig(data);
                 } else {
                     setConnectionError(testResult.message);
                     setPendingSubmission(data);
                 }
             } catch (_e) {
                 toast.dismiss(toastId);
                 setConnectionError("Could not test connection due to an unexpected error.");
                 setPendingSubmission(data);
             }
        } else {
            await saveConfig(data);
        }
    };

    return (
        <>
            <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                {/* Header: Name and Type */}
                <div className="space-y-4">
                    <FormField
                        control={form.control}
                        name="name"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Name</FormLabel>
                                <FormControl>
                                    <Input placeholder={type === "notification" ? "My Notification Channel" : "My Production DB"} {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />

<div className="flex w-full gap-4 items-start">
                        {adapters.length === 1 ? (
                            // Single adapter pre-selected (from picker) — show as read-only badge
                            <FormField
                                control={form.control}
                                name="adapterId"
                                render={() => (
                                    <FormItem className={cn("flex flex-col", selectedAdapterId === 'sqlite' ? "w-1/2" : "w-full")}>
                                        <FormLabel>Type</FormLabel>
                                        <Badge variant="secondary" className="w-fit text-sm py-1.5 px-3">
                                            {adapters[0].name}
                                        </Badge>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        ) : (
                        <FormField
                            control={form.control}
                            name="adapterId"
                            render={({ field }) => (
                                <FormItem className={cn("flex flex-col", selectedAdapterId === 'sqlite' ? "w-1/2" : "w-full")}>
                                    <FormLabel>Type</FormLabel>
                                    <Popover>
                                        <PopoverTrigger asChild>
                                            <FormControl>
                                                <Button
                                                    variant="outline"
                                                    role="combobox"
                                                    className={cn(
                                                        "justify-between",
                                                        selectedAdapterId === 'sqlite' ? "w-full" : "w-1/2",
                                                        !field.value && "text-muted-foreground"
                                                    )}
                                                    disabled={!!initialData}
                                                >
                                                    {field.value
                                                        ? (
                                                            <span className="flex items-center gap-2">
                                                                <AdapterIcon adapterId={field.value} className="h-4 w-4" />
                                                                {adapters.find((adapter) => adapter.id === field.value)?.name}
                                                            </span>
                                                        )
                                                        : "Select a type"}
                                                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                                </Button>
                                            </FormControl>
                                        </PopoverTrigger>
                                        <PopoverContent className={cn("p-0", hasGroups ? "w-80" : "w-62.5")} align="start">
                                            <Command>
                                                <CommandInput placeholder="Search type..." />
                                                <CommandList>
                                                    <CommandEmpty>No type found.</CommandEmpty>
                                                    {adapterGroups.map((group) => (
                                                        <CommandGroup key={group.label} heading={group.label || undefined}>
                                                            {group.items.map((adapter) => (
                                                                <CommandItem
                                                                    value={adapter.name}
                                                                    key={adapter.id}
                                                                    onSelect={() => {
                                                                        form.setValue("adapterId", adapter.id)
                                                                        setSelectedAdapterId(adapter.id);
                                                                    }}
                                                                    className={cn(adapter.id === field.value && "bg-accent")}
                                                                >
                                                                    <AdapterIcon adapterId={adapter.id} className="h-4 w-4" />
                                                                    {adapter.name}
                                                                </CommandItem>
                                                            ))}
                                                        </CommandGroup>
                                                    ))}
                                                </CommandList>
                                            </Command>
                                        </PopoverContent>
                                    </Popover>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        )}
                        {selectedAdapterId === 'sqlite' && selectedAdapter && (
                            <div className="w-1/2">
                                <SchemaField
                                    name="config.mode"
                                    fieldKey="mode"
                                    schemaShape={(selectedAdapter.configSchema as any).shape.mode}
                                    adapterId="sqlite"
                                />
                            </div>
                        )}
                    </div>
                </div>

                {selectedAdapter && type === 'database' && (
                    <DatabaseFormContent
                        adapter={selectedAdapter}
                        detectedVersion={detectedVersion}
                        availableDatabases={availableDatabases}
                        isLoadingDbs={isLoadingDbs}
                        onLoadDbs={() => fetchDatabases(form.getValues().config)}
                        isDbListOpen={isDbListOpen}
                        setIsDbListOpen={setIsDbListOpen}
                    />
                )}

                {selectedAdapter && type === 'storage' && (
                    <StorageFormContent adapter={selectedAdapter} initialData={initialData} />
                )}

                {selectedAdapter && type === 'notification' && (
                    <NotificationFormContent adapter={selectedAdapter} />
                )}

                {selectedAdapter && type !== 'database' && type !== 'storage' && type !== 'notification' && (
                    <GenericFormContent adapter={selectedAdapter} detectedVersion={detectedVersion} />
                )}

                {/* Dialog Footer Actions */}
                <div className="flex flex-col-reverse sm:flex-row sm:justify-between gap-2 pt-4">
                    <div>
                        {onBack && !initialData && (
                            <Button type="button" variant="ghost" onClick={onBack}>
                                ← Change Type
                            </Button>
                        )}
                    </div>
                    <div className="flex flex-col-reverse sm:flex-row sm:space-x-2 gap-2">
                        {(type === 'notification' || type === 'database' || type === 'storage') && (
                            <Button
                                type="button"
                                variant="secondary"
                                onClick={testConnection}
                                disabled={!selectedAdapter}
                            >
                                Test Connection
                            </Button>
                        )}
                        <Button type="submit" disabled={!selectedAdapter}>
                            {initialData ? "Save Changes" : "Create"}
                        </Button>
                    </div>
                </div>
            </form>
        </Form>

        <AlertDialog open={!!connectionError} onOpenChange={(open) => !open && setConnectionError(null)}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <div className="flex items-center gap-2 text-destructive">
                        <AlertCircle className="h-5 w-5" />
                        <AlertDialogTitle>Connection Failed</AlertDialogTitle>
                    </div>
                    <AlertDialogDescription className="pt-2 flex flex-col gap-2">
                        <p>We could not establish a connection to the database.</p>
                        <div className="bg-muted p-3 rounded-md text-xs font-mono break-all text-destructive">
                            {connectionError}
                        </div>
                        <p className="font-medium mt-2">Do you want to save this configuration anyway?</p>
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel onClick={() => { setConnectionError(null); setPendingSubmission(null); }}>
                        Cancel, let me fix it
                    </AlertDialogCancel>
                    <AlertDialogAction onClick={() => {
                        setConnectionError(null);
                        if (pendingSubmission) {
                             saveConfig(pendingSubmission);
                        }
                    }}>
                        Save Anyway
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
        </>
    );
}

