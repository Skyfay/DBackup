
"use client";

import { useState, useEffect, useMemo, useRef } from "react";
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

import { Loader2 } from "lucide-react";
import { AdapterDefinition } from "@/lib/adapters/definitions";
import { AdapterConfig } from "./types";
import { useAdapterConnection } from "./use-adapter-connection";
import { DatabaseFormContent, GenericFormContent, NotificationFormContent, StorageFormContent } from "./form-sections";
import { SchemaField } from "./schema-field";
import { SecretStatusProvider } from "./secret-status-context";

/**
 * Walks a Zod schema shape and calls form.setValue for every field that has a
 * Zod .default(...) value AND whose current form value is undefined.
 * This seeds enum/boolean/number defaults without wiping values already typed.
 */
function seedSchemaDefaults(schema: z.ZodTypeAny, form: any) {
    if (!(schema instanceof z.ZodObject)) return;
    const shape = (schema as z.ZodObject<any>).shape;
    for (const [key, raw] of Object.entries(shape)) {
        const currentVal = form.getValues(`config.${key}`);
        if (currentVal !== undefined) continue;
        // Walk wrappers (Optional, Nullable) to find ZodDefault
        let s = raw as z.ZodTypeAny;
        while (s) {
            const typeName = (s as any)._def?.typeName;
            if (typeName === "ZodDefault") {
                form.setValue(`config.${key}`, (s as any)._def.defaultValue());
                break;
            }
            if ((s as any)._def?.innerType) {
                s = (s as any)._def.innerType;
            } else {
                break;
            }
        }
    }
}

export function AdapterForm({ type, adapters, onSuccess, initialData, onBack }: { type: string, adapters: AdapterDefinition[], onSuccess: () => void, initialData?: AdapterConfig, onBack?: () => void }) {
    const [selectedAdapterId, setSelectedAdapterId] = useState<string>(initialData?.adapterId || "");

    // Health check notification opt-out (database & storage only)
    const initialMeta = initialData?.metadata ? JSON.parse(initialData.metadata) : {};
    const [healthNotificationsDisabled, setHealthNotificationsDisabled] = useState<boolean>(initialMeta.healthNotificationsDisabled === true);

    // Exclude from restore (database only)
    const [isRestoreExcluded, setIsRestoreExcluded] = useState<boolean>(initialMeta.isRestoreExcluded === true);

    // Credential profile assignments (Phase 4 - Generic Credential Profile System)
    const [primaryCredentialId, setPrimaryCredentialId] = useState<string | null>(initialData?.primaryCredentialId ?? null);
    const [sshCredentialId, setSshCredentialId] = useState<string | null>(initialData?.sshCredentialId ?? null);

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

    // When a credential profile is assigned, the fields it covers are hidden from
    // the form and will never be populated - so we strip them from the config
    // schema before validation to avoid a silent required-field failure.
    const configSchema = useMemo(() => {
        if (!selectedAdapter) return z.any();
        const base = selectedAdapter.configSchema;
        if (!(base instanceof z.ZodObject)) return base;

        const credentialKeys: string[] = [];
        if (selectedAdapter.credentials?.primary === "ACCESS_KEY") {
            credentialKeys.push("accessKeyId", "secretAccessKey");
        }
        if (selectedAdapter.credentials?.primary === "USERNAME_PASSWORD") {
            credentialKeys.push("user", "username", "password");
        }
        if (selectedAdapter.credentials?.primary === "SSH_KEY") {
            // SFTP/Rsync: unprefixed identity fields
            credentialKeys.push("username", "authType", "password", "privateKey", "passphrase");
        }
        if (selectedAdapter.credentials?.primary === "TOKEN") {
            credentialKeys.push("token", "appToken", "accessToken", "botToken", "authToken");
        }
        if (selectedAdapter.credentials?.primary === "SMTP") {
            credentialKeys.push("user", "password");
        }
        if (selectedAdapter.credentials?.primary === "WEBHOOK") {
            credentialKeys.push("webhookUrl", "url", "authHeader");
        }
        if (selectedAdapter.credentials?.primary === "OAUTH") {
            credentialKeys.push("clientId", "clientSecret", "refreshToken");
        }
        if (selectedAdapter.credentials?.ssh === "SSH_KEY") {
            credentialKeys.push(
                "sshUsername", "sshAuthType", "sshPassword", "sshPrivateKey", "sshPassphrase",
                "username", "authType", "privateKey", "passphrase"
            );
        }

        if (credentialKeys.length === 0) return base;

        // Make each credential-managed field optional so validation passes
        // even though those inputs are hidden.
        const shape = (base as z.ZodObject<any>).shape;
        const patchedShape: Record<string, z.ZodTypeAny> = { ...shape };
        for (const key of credentialKeys) {
            if (patchedShape[key]) {
                patchedShape[key] = patchedShape[key].optional();
            }
        }
        return z.object(patchedShape);
    }, [selectedAdapter]);

    const schema = z.object({
        name: z.string().min(1, "Name is required"),
        adapterId: z.string().min(1, "Type is required"),
        config: configSchema,
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
        isTesting,
        testConnection,
    } = useAdapterConnection({
        adapterId: selectedAdapterId,
        form,
        initialDataId: initialData?.id,
        primaryCredentialId,
        sshCredentialId
    });

    // Track which adapter we have already seeded defaults for, to avoid
    // overwriting values the user has already typed when the parent re-renders
    // and passes a new (but equivalent) adapters array reference.
    const seededAdapterRef = useRef<string | null>(null);

    // Update form schema/values when adapter changes
    useEffect(() => {
        if (!initialData && adapters.length === 1) {
            const firstId = adapters[0].id;
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setSelectedAdapterId(firstId);
            form.setValue("adapterId", firstId);

            // Only seed enum/default values once per adapter - never wipe the whole
            // config object, which would destroy values the user has already typed.
            if (seededAdapterRef.current !== firstId) {
                seededAdapterRef.current = firstId;
                seedSchemaDefaults(adapters[0].configSchema, form);
            }
        }
    }, [adapters, initialData, form]);


    const saveConfig = async (data: any) => {
        try {
            const url = initialData ? `/api/adapters/${initialData.id}` : '/api/adapters';
            const method = initialData ? 'PUT' : 'POST';

            // Build metadata with health notification preference for database/storage adapters
            const existingMeta = initialData?.metadata ? JSON.parse(initialData.metadata) : {};
            const metadata = (type === 'database' || type === 'storage')
                ? { ...existingMeta, healthNotificationsDisabled, ...(type === 'database' ? { isRestoreExcluded } : {}) }
                : existingMeta;

            const payload = {
                ...data, // name, adapterId
                config: data.config,
                type: type, // ensure type is sent
                metadata,
                primaryCredentialId,
                sshCredentialId,
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
                const result = await res.json().catch(() => null);
                toast.error(result?.error || "Operation failed");
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
                     body: JSON.stringify({ adapterId: data.adapterId, config: data.config, primaryCredentialId, sshCredentialId })
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
            <SecretStatusProvider value={initialData?.secretStatus ?? {}}>
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
                            // Single adapter pre-selected (from picker) - show as read-only badge
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
                                                                        form.setValue("adapterId", adapter.id);
                                                                        setSelectedAdapterId(adapter.id);
                                                                        if (!initialData) {
                                                                            // User actively switched adapter: reset config and re-seed defaults
                                                                            form.setValue("config", {});
                                                                            seededAdapterRef.current = adapter.id;
                                                                            seedSchemaDefaults(adapter.configSchema, form);
                                                                        }
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
                        {selectedAdapterId !== 'sqlite' && selectedAdapter && (selectedAdapter.configSchema as any).shape?.connectionMode && (
                            <div className="w-1/2">
                                <SchemaField
                                    name="config.connectionMode"
                                    fieldKey="connectionMode"
                                    schemaShape={(selectedAdapter.configSchema as any).shape.connectionMode}
                                    adapterId={selectedAdapterId}
                                />
                            </div>
                        )}
                    </div>
                </div>

                {selectedAdapter && type === 'database' && (
                    <DatabaseFormContent
                        adapter={selectedAdapter}
                        detectedVersion={detectedVersion}
                        healthNotificationsDisabled={healthNotificationsDisabled}
                        onHealthNotificationsDisabledChange={setHealthNotificationsDisabled}
                        isRestoreExcluded={isRestoreExcluded}
                        onIsRestoreExcludedChange={setIsRestoreExcluded}
                        primaryCredentialId={primaryCredentialId}
                        sshCredentialId={sshCredentialId}
                        onPrimaryChange={setPrimaryCredentialId}
                        onSshChange={setSshCredentialId}
                    />
                )}

                {selectedAdapter && type === 'storage' && (
                    <StorageFormContent
                        adapter={selectedAdapter}
                        initialData={initialData}
                        healthNotificationsDisabled={healthNotificationsDisabled}
                        onHealthNotificationsDisabledChange={setHealthNotificationsDisabled}
                        primaryCredentialId={primaryCredentialId}
                        sshCredentialId={sshCredentialId}
                        onPrimaryChange={setPrimaryCredentialId}
                        onSshChange={setSshCredentialId}
                    />
                )}

                {selectedAdapter && type === 'notification' && (
                    <NotificationFormContent
                        adapter={selectedAdapter}
                        primaryCredentialId={primaryCredentialId}
                        onPrimaryChange={setPrimaryCredentialId}
                    />
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
                                disabled={!selectedAdapter || isTesting || form.formState.isSubmitting}
                            >
                                {isTesting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                Test Connection
                            </Button>
                        )}
                        <Button type="submit" disabled={!selectedAdapter || form.formState.isSubmitting || isTesting}>
                            {form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {initialData ? "Save Changes" : "Create"}
                        </Button>
                    </div>
                </div>
            </form>
            </SecretStatusProvider>
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

