
"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { ChevronsUpDown, Check, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { AdapterDefinition } from "@/lib/adapters/definitions";
import { AdapterConfig } from "./types";
import { STORAGE_CONFIG_KEYS, STORAGE_CONNECTION_KEYS } from "./form-constants";
import { SchemaField } from "./schema-field";
import { useAdapterConnection } from "./use-adapter-connection";

export function AdapterForm({ type, adapters, onSuccess, initialData }: { type: string, adapters: AdapterDefinition[], onSuccess: () => void, initialData?: AdapterConfig }) {
    const [selectedAdapterId, setSelectedAdapterId] = useState<string>(initialData?.adapterId || "");

    const selectedAdapter = adapters.find(a => a.id === selectedAdapterId);

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
            setSelectedAdapterId(adapters[0].id);
            form.setValue("adapterId", adapters[0].id);
        }
    }, [adapters, initialData, form]);


    const saveConfig = async (data: any) => {
        try {
            const url = initialData ? `/api/adapters/${initialData.id}` : '/api/adapters';
            const method = initialData ? 'PUT' : 'POST';

            const payload = {
                ...data,
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
        } catch (error) {
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
             } catch (e) {
                 toast.dismiss(toastId);
                 setConnectionError("Could not test connection due to an unexpected error.");
                 setPendingSubmission(data);
             }
        } else {
            await saveConfig(data);
        }
    };

    // Helper to check if adapter has specific fields
    function hasFields(keys: string[]) {
         if (!selectedAdapter) return false;
         const shape = (selectedAdapter.configSchema as any).shape;
         return keys.some(key => key in shape);
    }

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

                    <FormField
                        control={form.control}
                        name="adapterId"
                        render={({ field }) => (
                            <FormItem className="flex flex-col">
                                <FormLabel>Type</FormLabel>
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <FormControl>
                                            <Button
                                                variant="outline"
                                                role="combobox"
                                                className={cn(
                                                    "w-1/2 justify-between",
                                                    !field.value && "text-muted-foreground"
                                                )}
                                                disabled={!!initialData}
                                            >
                                                {field.value
                                                    ? adapters.find(
                                                        (adapter) => adapter.id === field.value
                                                    )?.name
                                                    : "Select a type"}
                                                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                            </Button>
                                        </FormControl>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-[250px] p-0" align="start">
                                        <Command>
                                            <CommandInput placeholder="Search type..." />
                                            <CommandList>
                                                <CommandEmpty>No type found.</CommandEmpty>
                                                <CommandGroup>
                                                    {adapters.map((adapter) => (
                                                        <CommandItem
                                                            value={adapter.name}
                                                            key={adapter.id}
                                                            onSelect={() => {
                                                                form.setValue("adapterId", adapter.id)
                                                                setSelectedAdapterId(adapter.id);
                                                            }}
                                                        >
                                                            <Check
                                                                className={cn(
                                                                    "mr-2 h-4 w-4",
                                                                    adapter.id === field.value
                                                                        ? "opacity-100"
                                                                        : "opacity-0"
                                                                )}
                                                            />
                                                            {adapter.name}
                                                        </CommandItem>
                                                    ))}
                                                </CommandGroup>
                                            </CommandList>
                                        </Command>
                                    </PopoverContent>
                                </Popover>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </div>

                {selectedAdapter && type === 'database' && (
                    <Tabs defaultValue="connection" className="w-full">
                        <TabsList className="grid w-full grid-cols-2">
                            <TabsTrigger value="connection">Connection</TabsTrigger>
                            <TabsTrigger value="configuration">Configuration</TabsTrigger>
                        </TabsList>

                        {/* TAB 1: CONNECTION */}
                        <TabsContent value="connection" className="space-y-4 pt-4">
                            {renderDatabaseConnectionFields()}
                        </TabsContent>

                        {/* TAB 2: CONFIGURATION */}
                        <TabsContent value="configuration" className="space-y-4 pt-4">
                            {renderDatabaseConfigurationFields()}
                        </TabsContent>
                    </Tabs>
                )}

                {selectedAdapter && type === 'storage' && (
                    <Tabs defaultValue="connection" className="w-full">
                        <TabsList className={cn("grid w-full", hasFields(STORAGE_CONFIG_KEYS) ? "grid-cols-2" : "grid-cols-1")}>
                            <TabsTrigger value="connection">Connection</TabsTrigger>
                            {hasFields(STORAGE_CONFIG_KEYS) && (
                                <TabsTrigger value="configuration">Configuration</TabsTrigger>
                            )}
                        </TabsList>

                        {/* TAB 1: CONNECTION */}
                        <TabsContent value="connection" className="space-y-4 pt-4">
                            {renderStorageConnectionFields()}
                        </TabsContent>

                        {/* TAB 2: CONFIGURATION */}
                        {hasFields(STORAGE_CONFIG_KEYS) && (
                            <TabsContent value="configuration" className="space-y-4 pt-4">
                                {renderStorageConfigurationFields()}
                            </TabsContent>
                        )}
                    </Tabs>
                )}

                {selectedAdapter && type !== 'database' && type !== 'storage' && (
                    <div className="space-y-4 border p-4 rounded-md bg-muted/30">
                        <div className="flex items-center justify-between">
                             <h4 className="text-sm font-medium">Configuration</h4>
                             {detectedVersion && (
                                <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20">
                                    <Check className="w-3 h-3 mr-1" />
                                    Detected: {detectedVersion}
                                </Badge>
                             )}
                        </div>
                         {renderOtherFields()}
                    </div>
                )}

                {/* Dialog Footer Actions */}
                <div className="flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2 gap-2 pt-4">
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

    // Helper Functions for Rendering Fields
    function renderDatabaseConnectionFields() {
        if (!selectedAdapter) return null;

        const connectionFields = ['uri', 'host', 'port', 'user', 'password'];
        return (
            <>
                {detectedVersion && (
                    <div className="mb-4">
                        <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20">
                            <Check className="w-3 h-3 mr-1" />
                            Detected: {detectedVersion}
                        </Badge>
                    </div>
                )}
                {renderFields(connectionFields)}
            </>
        );
    }

    function renderDatabaseConfigurationFields() {
        if (!selectedAdapter) return null;

        const configFields = ['database', 'authenticationDatabase', 'options', 'disableSsl'];
        return (
            <>
                {detectedVersion && (
                    <div className="mb-4">
                        <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20">
                            <Check className="w-3 h-3 mr-1" />
                            Detected: {detectedVersion}
                        </Badge>
                    </div>
                )}
                {renderFields(configFields)}
            </>
        );
    }
    function renderStorageConnectionFields() {
        if (!selectedAdapter) return null;

        // Custom Layout for SFTP
        if (selectedAdapter.id === 'sftp') {
            return (
                <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <div className="md:col-span-3">
                             {renderFields(['host'])}
                        </div>
                        <div className="md:col-span-1">
                             {renderFields(['port'])}
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {renderFields(['username'])}
                        {renderFields(['password'])}
                    </div>

                    {renderFields(['privateKey', 'passphrase'])}
                </div>
            );
        }

        // Generic Layout for others
        return (
            <>
                 {renderFields(STORAGE_CONNECTION_KEYS)}
            </>
        );
    }

    function renderStorageConfigurationFields() {
        if (!selectedAdapter) return null;

        return (
            <>
                {renderFields(STORAGE_CONFIG_KEYS)}
            </>
        );
    }

    function renderOtherFields() {
        if (!selectedAdapter) return null;

        return renderFields(Object.keys((selectedAdapter.configSchema as any).shape));
    }

    function renderFields(fieldKeys: string[]) {
        if (!selectedAdapter) return null;

        return fieldKeys.map((key) => {
            // Skip if field doesn't exist in schema
            if (!((selectedAdapter.configSchema as any).shape[key])) return null;

            const shape = (selectedAdapter.configSchema as any).shape[key];

            return (
                <SchemaField
                    key={key}
                    name={`config.${key}`}
                    fieldKey={key}
                    schemaShape={shape}
                    adapterId={selectedAdapter.id}
                    isDatabaseField={key === 'database' && type === 'database'}
                    availableDatabases={availableDatabases}
                    isLoadingDbs={isLoadingDbs}
                    onLoadDbs={() => fetchDatabases(form.getValues().config)}
                    isDbListOpen={isDbListOpen}
                    setIsDbListOpen={setIsDbListOpen}
                />
            );
        });
    }
}

