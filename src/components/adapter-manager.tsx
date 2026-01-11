"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { ADAPTER_DEFINITIONS, AdapterDefinition } from "@/lib/adapters/definitions";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Trash2, Plus, Edit, AlertCircle, Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface AdapterManagerProps {
    type: 'database' | 'storage' | 'notification';
    title: string;
    description: string;
}

interface AdapterConfig {
    id: string;
    name: string;
    adapterId: string;
    type: string;
    config: string; // JSON string
    createdAt: string;
}

export function AdapterManager({ type, title, description }: AdapterManagerProps) {
    const [configs, setConfigs] = useState<AdapterConfig[]>([]);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [availableAdapters, setAvailableAdapters] = useState<AdapterDefinition[]>([]);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    useEffect(() => {
        // Filter definitions by type
        setAvailableAdapters(ADAPTER_DEFINITIONS.filter(d => d.type === type));
        fetchConfigs();
    }, [type]);

    const fetchConfigs = async () => {
        try {
            const res = await fetch(`/api/adapters?type=${type}`);
            if (res.ok) {
                const data = await res.json();
                setConfigs(data);
            }
        } catch (error) {
            toast.error("Failed to load configurations");
        }
    };

    const handleDelete = (id: string) => {
        setDeletingId(id);
    };

    const confirmDelete = async () => {
        if (!deletingId) return;
        const id = deletingId;

        try {
            const res = await fetch(`/api/adapters/${id}`, { method: 'DELETE' });
            if (res.ok) {
                toast.success("Configuration deleted");
                setConfigs(configs.filter(c => c.id !== id));
            } else {
                toast.error("Failed to delete");
            }
        } catch (error) {
             toast.error("Error deleting configuration");
        } finally {
            setDeletingId(null);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">{title}</h2>
                    <p className="text-muted-foreground">{description}</p>
                </div>
                <Button onClick={() => { setEditingId(null); setIsDialogOpen(true); }}>
                    <Plus className="mr-2 h-4 w-4" /> Add New
                </Button>
            </div>

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {configs.map((config) => (
                    <AdapterCard
                        key={config.id}
                        config={config}
                        definition={ADAPTER_DEFINITIONS.find(d => d.id === config.adapterId)!}
                        onDelete={() => handleDelete(config.id)}
                        onEdit={() => { setEditingId(config.id); setIsDialogOpen(true); }}
                    />
                ))}
            </div>

            {configs.length === 0 && (
                 <div className="rounded-md border p-8 text-center text-muted-foreground bg-muted/10">
                    No configurations found. Click "Add New" to get started.
                </div>
            )}

            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>{editingId ? "Edit Configuration" : "Add New Configuration"}</DialogTitle>
                    </DialogHeader>
                    {isDialogOpen && (
                        <AdapterForm
                            type={type}
                            adapters={availableAdapters}
                            onSuccess={() => { setIsDialogOpen(false); fetchConfigs(); }}
                            initialData={editingId ? configs.find(c => c.id === editingId) : undefined}
                        />
                    )}
                </DialogContent>
            </Dialog>

            <AlertDialog open={!!deletingId} onOpenChange={(open) => !open && setDeletingId(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This action cannot be undone. This will permanently delete this configuration.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}

function AdapterCard({ config, definition, onDelete, onEdit }: { config: AdapterConfig, definition: AdapterDefinition, onDelete: () => void, onEdit: () => void }) {
    const parsedConfig = JSON.parse(config.config);
    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-lg font-medium">
                     {config.name}
                </CardTitle>
                <div className="bg-primary/10 text-primary px-2 py-1 rounded text-xs font-semibold">
                    {definition?.name || config.adapterId}
                </div>
            </CardHeader>
            <CardContent>
                <div className="text-xs text-muted-foreground mt-2 space-y-1">
                    {Object.entries(parsedConfig).slice(0, 3).map(([key, value]) => (
                         <div key={key} className="flex justify-between">
                            <span className="capitalize">{key}:</span>
                            <span className="font-mono truncate max-w-[150px]">{String(value)}</span>
                        </div>
                    ))}
                </div>
            </CardContent>
            <CardFooter className="flex justify-end gap-2">
                 <Button variant="ghost" size="icon" onClick={onEdit}>
                    <Edit className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={onDelete}>
                    <Trash2 className="h-4 w-4" />
                </Button>
            </CardFooter>
        </Card>
    )
}

function AdapterForm({ type, adapters, onSuccess, initialData }: { type: string, adapters: AdapterDefinition[], onSuccess: () => void, initialData?: AdapterConfig }) {
    const [selectedAdapterId, setSelectedAdapterId] = useState<string>(initialData?.adapterId || "");
    const [connectionError, setConnectionError] = useState<string | null>(null);
    const [pendingSubmission, setPendingSubmission] = useState<any | null>(null);

    // Multi-Select DB Logic
    const [availableDatabases, setAvailableDatabases] = useState<string[]>([]);
    const [isLoadingDbs, setIsLoadingDbs] = useState(false);
    const [isDbListOpen, setIsDbListOpen] = useState(false);

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

    const fetchDatabases = async (currentConfig: any) => {
        if (!selectedAdapterId) return;

        setIsLoadingDbs(true);
        try {
             const testRes = await fetch('/api/adapters/test-connection', {
                 method: 'POST',
                 headers: { 'Content-Type': 'application/json' },
                 body: JSON.stringify({ adapterId: selectedAdapterId, config: currentConfig })
             });
             const testResult = await testRes.json();

             if (!testResult.success) {
                 toast.error(`Connection failed: ${testResult.message}`);
                 setAvailableDatabases([]);
                 setIsLoadingDbs(false);
                 return;
             }

             const res = await fetch('/api/adapters/access-check', {
                 method: 'POST',
                 headers: { 'Content-Type': 'application/json' },
                 body: JSON.stringify({ adapterId: selectedAdapterId, config: currentConfig })
             });
             const data = await res.json();

             if(data.success) {
                 setAvailableDatabases(data.databases);
                 setConnectionError(null);
                 toast.success(`Loaded ${data.databases.length} databases`);
                 setIsDbListOpen(true);
             } else {
                 toast.error("Failed to list databases: " + (data.error || "Unknown"));
             }
        } catch(e) {
            console.error(e);
            toast.error("Network error while listing databases");
        } finally {
            setIsLoadingDbs(false);
        }
    };

    const form = useForm({
        resolver: zodResolver(schema),
        defaultValues: {
            name: initialData?.name || "",
            adapterId: initialData?.adapterId || (adapters.length === 1 ? adapters[0].id : ""),
            config: initialData ? JSON.parse(initialData.config) : {}
        }
    });

    // Update form schema/values when adapter changes
    // But preserve what we can? Easier to just reset config part if adapter changes
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

    return (
        <>
            <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Name</FormLabel>
                            <FormControl>
                                <Input placeholder="My Production DB" {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <FormField
                    control={form.control}
                    name="adapterId"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Type</FormLabel>
                            <Select
                                onValueChange={(val) => {
                                    field.onChange(val);
                                    setSelectedAdapterId(val);
                                    // Reset config fields on type change?
                                }}
                                defaultValue={field.value}
                                disabled={!!initialData} // Disable changing type purely for simplicity for now
                            >
                                <FormControl>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select a type" />
                                    </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                    {adapters.map((adapter) => (
                                        <SelectItem key={adapter.id} value={adapter.id}>
                                            {adapter.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                {selectedAdapter && (
                    <div className="space-y-4 border p-4 rounded-md bg-muted/30">
                        <h4 className="text-sm font-medium">Configuration</h4>
                         {/* Dynamic Form Fields based on Zod Schema */}
                         {/* This is a simplified renderer. For complex schemas, a recursive component is better. */}
                         {Object.keys((selectedAdapter.configSchema as any).shape).map((key) => {
                             const shape = (selectedAdapter.configSchema as any).shape[key];
                             const label = key.charAt(0).toUpperCase() + key.slice(1);
                             const isBoolean = shape instanceof z.ZodBoolean || shape._def?.typeName === "ZodBoolean";
                             // Very basic type checking
                             const isPassword = key.toLowerCase().includes("password") || key.toLowerCase().includes("secret");
                             const description = shape.description;
                             const isDatabaseField = key === 'database' && type === 'database';

                             return (
                                 <FormField
                                    key={key}
                                    control={form.control}
                                    name={`config.${key}`}
                                    render={({ field }) => (
                                        <FormItem className={isBoolean ? "flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm" : ""}>
                                            <div className="space-y-0.5">
                                                <FormLabel>{label}</FormLabel>
                                                {description && <FormDescription>{description}</FormDescription>}
                                            </div>
                                            <FormControl>
                                                {isBoolean ? (
                                                    // Checkbox for boolean
                                                    <input
                                                        type="checkbox"
                                                        checked={field.value}
                                                        onChange={field.onChange}
                                                        className="h-4 w-4"
                                                    />
                                                ) : isDatabaseField ? (
                                                    <div className="flex gap-2">
                                                        <Popover open={isDbListOpen} onOpenChange={setIsDbListOpen}>
                                                            <PopoverTrigger asChild>
                                                                <Button
                                                                    variant="outline"
                                                                    role="combobox"
                                                                    className="flex-1 justify-between h-auto min-h-[40px]"
                                                                >
                                                                    {field.value && (Array.isArray(field.value) ? field.value.length > 0 : field.value) ? (
                                                                         <div className="flex flex-wrap gap-1">
                                                                            {Array.isArray(field.value)
                                                                               ? field.value.map((db: string) => <Badge variant="secondary" key={db} className="mr-1">{db}</Badge>)
                                                                               : <Badge variant="secondary">{field.value}</Badge>
                                                                            }
                                                                         </div>
                                                                    ) : "Select databases..."}
                                                                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                                                </Button>
                                                            </PopoverTrigger>
                                                            <PopoverContent className="w-[400px] p-0" align="start">
                                                                <Command>
                                                                    <CommandInput placeholder="Search databases..." />
                                                                    <CommandList>
                                                                        <CommandEmpty>
                                                                            {isLoadingDbs ? (
                                                                                 <div className="flex items-center justify-center p-4">
                                                                                     <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                                                                     Loading...
                                                                                 </div>
                                                                            ) : "No database found or not loaded."}
                                                                        </CommandEmpty>
                                                                        <CommandGroup>
                                                                            {availableDatabases.map((db) => (
                                                                                <CommandItem
                                                                                    value={db}
                                                                                    key={db}
                                                                                    onSelect={(currentValue) => {
                                                                                        const current = Array.isArray(field.value) ? field.value : (field.value ? [field.value] : []);
                                                                                        const isSelected = current.includes(currentValue);
                                                                                        let newValue;
                                                                                        if (isSelected) {
                                                                                            newValue = current.filter((v: string) => v !== currentValue);
                                                                                        } else {
                                                                                            newValue = [...current, currentValue];
                                                                                        }
                                                                                        field.onChange(newValue);
                                                                                    }}
                                                                                >
                                                                                    <Check
                                                                                        className={cn(
                                                                                            "mr-2 h-4 w-4",
                                                                                            (Array.isArray(field.value) ? field.value.includes(db) : field.value === db)
                                                                                                ? "opacity-100"
                                                                                                : "opacity-0"
                                                                                        )}
                                                                                    />
                                                                                    {db}
                                                                                </CommandItem>
                                                                            ))}
                                                                        </CommandGroup>
                                                                    </CommandList>
                                                                </Command>
                                                            </PopoverContent>
                                                        </Popover>
                                                        <Button
                                                            type="button"
                                                            variant="secondary"
                                                            onClick={() => fetchDatabases(form.getValues().config)}
                                                            disabled={isLoadingDbs}
                                                        >
                                                             {isLoadingDbs ? <Loader2 className="h-4 w-4 animate-spin" /> : "Load"}
                                                        </Button>
                                                    </div>
                                                ) : (
                                                    <Input
                                                        type={isPassword ? "password" : "text"}
                                                        {...field}
                                                        value={field.value || ""}
                                                        onChange={(e) => {
                                                            const val = e.target.value;
                                                            // Auto coercion for numbers if schema expects number
                                                            if (shape instanceof z.ZodNumber || shape._def?.typeName === "ZodNumber") {
                                                                field.onChange(Number(val));
                                                            } else {
                                                                field.onChange(val);
                                                            }
                                                        }}
                                                    />
                                                )}
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                             );
                         })}
                    </div>
                )}

                <Button type="submit" disabled={!selectedAdapter} className="w-full">
                    {initialData ? "Save Changes" : "Create"}
                </Button>
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
                        if (pendingSubmission) saveConfig(pendingSubmission);
                    }}>
                        Save Anyway
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
        </>
    );
}
