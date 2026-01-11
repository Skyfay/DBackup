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
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { ADAPTER_DEFINITIONS, AdapterDefinition } from "@/lib/adapters/definitions";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Trash2, Plus, Edit } from "lucide-react";
import { toast } from "sonner";

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

    const handleDelete = async (id: string) => {
        if (!confirm("Are you sure you want to delete this configuration?")) return;

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
                <DialogContent className="max-h-[80vh] overflow-y-auto">
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
    const selectedAdapter = adapters.find(a => a.id === selectedAdapterId);

    // Dynamic schema based on selection
    const schema = z.object({
        name: z.string().min(1, "Name is required"),
        adapterId: z.string().min(1, "Adapter type is required"),
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

    // Update form schema/values when adapter changes
    // But preserve what we can? Easier to just reset config part if adapter changes
    useEffect(() => {
        if (!initialData && adapters.length === 1) {
            setSelectedAdapterId(adapters[0].id);
            form.setValue("adapterId", adapters[0].id);
        }
    }, [adapters, initialData, form]);


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

                 if (testResult.success) {
                     toast.success("Connection test successful", { id: toastId });
                 } else {
                     toast.dismiss(toastId);
                     if (!confirm(`Connection Test Failed:\n${testResult.message}\n\nDo you want to save anyway?`)) {
                         return; // Abort save
                     }
                 }
             } catch (e) {
                 toast.dismiss(toastId);
                 if (!confirm("Could not test connection due to an error. Save anyway?")) {
                     return;
                 }
             }
        }

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

    return (
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
    );
}
