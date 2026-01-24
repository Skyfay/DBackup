
"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2, ChevronsUpDown, Check, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { AdapterDefinition } from "@/lib/adapters/definitions";
import { AdapterConfig } from "./types";

export function AdapterForm({ type, adapters, onSuccess, initialData }: { type: string, adapters: AdapterDefinition[], onSuccess: () => void, initialData?: AdapterConfig }) {
    const [selectedAdapterId, setSelectedAdapterId] = useState<string>(initialData?.adapterId || "");
    const [connectionError, setConnectionError] = useState<string | null>(null);
    const [pendingSubmission, setPendingSubmission] = useState<any | null>(null);

    // Version Detection (nur temporär während Bearbeitungs-Session)
    const [detectedVersion, setDetectedVersion] = useState<string | null>(null);

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
                 const newDbs = data.databases;
                 setAvailableDatabases(newDbs);
                 setConnectionError(null);

                 // Sync Logic: Check currently selected DBs. If any are NOT in the new list, remove them.
                 // This handles the case where DBs were deleted on the server side.
                 const currentConfig = form.getValues().config;
                 const currentSelected = currentConfig.database;

                 if (Array.isArray(currentSelected) && currentSelected.length > 0) {
                     const validSelection = currentSelected.filter((db: string) => newDbs.includes(db));

                     if (validSelection.length !== currentSelected.length) {
                         form.setValue('config.database', validSelection, { shouldDirty: true });

                         const removedCount = currentSelected.length - validSelection.length;
                         toast.warning(`Removed ${removedCount} unavailable database(s) from selection.`);
                     }
                 }

                 toast.success(`Loaded ${newDbs.length} databases`);
                 setIsDbListOpen(true);
             } else {
                 toast.error("Failed to list databases: " + (data.message || data.error || "Unknown"));
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


    const testConnection = async () => {
        const data = form.getValues();
        if (!data.adapterId) {
            toast.error("Please select an adapter type first");
            return;
        }

        const toastId = toast.loading("Testing connection...");
        try {
            const res = await fetch('/api/adapters/test-connection', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    adapterId: data.adapterId,
                    config: data.config,
                    configId: initialData?.id // Send configId if editing existing config
                })
            });
            const result = await res.json();

            toast.dismiss(toastId);

            if (result.success) {
                toast.success(result.message || "Connection successful");
                if (result.version) {
                    setDetectedVersion(result.version);
                }
            } else {
                toast.error(result.message || "Connection failed");
            }
        } catch (e) {
            toast.dismiss(toastId);
            toast.error("Failed to test connection");
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

                {selectedAdapter && type !== 'database' && (
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
                    {(type === 'notification' || type === 'database') && (
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

            // Helper to unwrap Zod wrappers (default, optional, etc.)
            let unwrappedShape = shape;
            while (
               unwrappedShape instanceof z.ZodOptional ||
               unwrappedShape instanceof z.ZodNullable ||
               unwrappedShape instanceof z.ZodDefault ||
               unwrappedShape._def?.typeName === "ZodDefault" ||
               unwrappedShape._def?.typeName === "ZodOptional"
            ) {
                unwrappedShape = unwrappedShape._def.innerType;
            }

            let label = key.charAt(0).toUpperCase() + key.slice(1);
            // Fix CamelCase to Space Case
            label = label.replace(/([A-Z])/g, ' $1').trim();
            // Specific fix for SSL
            if (key === 'disableSsl') label = "Disable SSL";
            if (key === 'uri') label = "URI";

            const isBoolean = unwrappedShape instanceof z.ZodBoolean || unwrappedShape._def?.typeName === "ZodBoolean";
            const isEnum = unwrappedShape instanceof z.ZodEnum || unwrappedShape._def?.typeName === "ZodEnum";
            const isPassword = key.toLowerCase().includes("password") || key.toLowerCase().includes("secret");
            const description = shape.description;
            const isDatabaseField = key === 'database' && type === 'database';

            const PLACEHOLDERS: Record<string, string> = {
               "email.from": "\"Backup Service\" <backup@example.com>",
               "email.host": "smtp.example.com",
               "email.user": "user@example.com",
               "from": "name@example.com",
               "to": "admin@example.com",
               "host": "localhost",
               // DB Ports
               "mysql.port": "3306",
               "postgres.port": "5432",
               "mongodb.port": "27017",
               "email.port": "587",
               "mongodb.uri": "mongodb://user:password@localhost:27017/db?authSource=admin",
               // Options Examples
               "mysql.options": "--single-transaction --quick",
               "postgres.options": "--clean --if-exists",
               "mongodb.options": "--gzip --oplog",

               // S3 Placeholders
               "bucket": "my-backup-bucket",
               "pathPrefix": "backups/prod",
               "accessKeyId": "AKIA...",
               "secretAccessKey": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",

               // AWS Specific
               "s3-aws.region": "us-east-1",

               // S3 Generic
               "s3-generic.endpoint": "https://s3.custom-provider.com",
               "s3-generic.region": "us-east-1",

               // R2 Specific
               "s3-r2.accountId": "32c49e7943c49e7943c49e7943c49e79",

               // Hetzner Specific (Enum default handles region, but just in case)
               "s3-hetzner.pathPrefix": "server1/mysql",
            };
            const placeholder = PLACEHOLDERS[`${selectedAdapter.id}.${key}`] || PLACEHOLDERS[key];

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
                                   <Switch
                                       checked={field.value}
                                       onCheckedChange={field.onChange}
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
                               ) : isEnum ? (
                                    <Select
                                       onValueChange={field.onChange}
                                       defaultValue={field.value}
                                       value={field.value}
                                   >
                                       <FormControl>
                                           <SelectTrigger>
                                               <SelectValue placeholder="Select..." />
                                           </SelectTrigger>
                                       </FormControl>
                                       <SelectContent>
                                           {((unwrappedShape as any).options || (unwrappedShape as any)._def?.values || []).map((val: string) => (
                                               <SelectItem key={val} value={val} className="capitalize">
                                                   {val === "none" ? "None (Insecure)" : val === "ssl" ? "SSL / TLS" : val === "starttls" ? "STARTTLS" : val}
                                               </SelectItem>
                                           ))}
                                       </SelectContent>
                                   </Select>
                               ) : (
                                   <Input
                                       type={isPassword ? "password" : "text"}
                                       {...field}
                                       placeholder={placeholder}
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
        });
    }
}

