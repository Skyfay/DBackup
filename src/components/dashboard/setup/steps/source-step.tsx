"use client";

import { useState, useMemo } from "react";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { toneAttribute } from "@/components/ui/tone";
import { Input } from "@/components/ui/input";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form";
import {
    AlertDialog,
    AlertDialogContent,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogCancel,
    AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, ArrowRight, Database, AlertCircle, CheckCircle2 } from "lucide-react";
import { AdapterDefinition } from "@/lib/adapters/definitions";
import { AdapterPicker } from "@/components/adapter/adapter-picker";
import { DatabaseFormContent } from "@/components/adapter/form-sections";
import { SchemaField } from "@/components/adapter/schema-field";
import { useAdapterConnection } from "@/components/adapter/use-adapter-connection";
import { WizardData } from "../setup-wizard";

interface SourceStepProps {
    adapters: AdapterDefinition[];
    wizardData: WizardData;
    onUpdate: (data: Partial<WizardData>) => void;
    onNext: () => void;
    onPrev: () => void;
}

export function SourceStep({ adapters, wizardData, onUpdate, onNext, onPrev }: SourceStepProps) {
    const [selectedAdapter, setSelectedAdapter] = useState<AdapterDefinition | null>(null);
    const [isSaved, setIsSaved] = useState(!!wizardData.sourceId);
    const [primaryCredentialId, setPrimaryCredentialId] = useState<string | null>(null);
    const [sshCredentialId, setSshCredentialId] = useState<string | null>(null);
    const [connectionError, setConnectionError] = useState<string | null>(null);
    const [pendingSubmission, setPendingSubmission] = useState<Record<string, unknown> | null>(null);

    // Patch schema: make credential-managed fields optional so hidden inputs
    // don't cause silent required-field validation failures.
    const configSchema = useMemo(() => {
        if (!selectedAdapter) return z.any();
        const base = selectedAdapter.configSchema;
        if (!(base instanceof z.ZodObject)) return base;
        const keys: string[] = [];
        if (selectedAdapter.credentials?.primary === "USERNAME_PASSWORD") keys.push("user", "username", "password");
        if (selectedAdapter.credentials?.primary === "SSH_KEY") keys.push("username", "authType", "password", "privateKey", "passphrase");
        if (selectedAdapter.credentials?.primary === "ACCESS_KEY") keys.push("accessKeyId", "secretAccessKey");
        if (selectedAdapter.credentials?.primary === "TOKEN") keys.push("token", "appToken", "accessToken", "botToken");
        if (selectedAdapter.credentials?.primary === "SMTP") keys.push("user", "password");
        if (selectedAdapter.credentials?.ssh === "SSH_KEY") keys.push("sshUsername", "sshAuthType", "sshPassword", "sshPrivateKey", "sshPassphrase", "username", "authType", "privateKey", "passphrase");
        if (keys.length === 0) return base;
        const shape = { ...base.shape };
        for (const k of keys) { if (shape[k]) shape[k] = shape[k].optional(); }
        return z.object(shape);
    }, [selectedAdapter]);

    // Dynamic schema based on selected adapter
    const schema = z.object({
        name: z.string().min(1, "Name is required"),
        config: configSchema,
    });

    const form = useForm({
        resolver: zodResolver(schema),
        defaultValues: {
            name: "",
            config: {},
        },
    });

    const {
        detectedVersion,
        testConnection,
    } = useAdapterConnection({
        adapterId: selectedAdapter?.id || "",
        form: form as unknown as ReturnType<typeof useForm>,
        primaryCredentialId,
        sshCredentialId,
    });

    const handleAdapterSelect = (adapter: AdapterDefinition) => {
        setSelectedAdapter(adapter);
        form.reset({ name: "", config: {} });
        setPrimaryCredentialId(null);
        setSshCredentialId(null);
        setIsSaved(false);
    };

    const saveConfig = async (data: { name: string; config: Record<string, unknown> }) => {
        try {
            const payload = {
                name: data.name,
                adapterId: selectedAdapter!.id,
                config: data.config,
                type: "database",
                primaryCredentialId,
                sshCredentialId,
            };

            const res = await fetch("/api/adapters", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            if (res.ok) {
                const result = await res.json();
                toast.success("Database source created successfully");
                onUpdate({
                    sourceId: result.id,
                    sourceName: data.name,
                    sourceAdapterId: selectedAdapter!.id,
                });
                setIsSaved(true);
            } else {
                const errResult = await res.json().catch(() => null);
                toast.error(errResult?.error || "Failed to create source");
            }
        } catch {
            toast.error("An error occurred while creating the source");
        }
    };

    const onSubmit = async (data: { name: string; config: Record<string, unknown> }) => {
        const toastId = toast.loading("Testing connection...");
        try {
            const testRes = await fetch("/api/adapters/test-connection", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    adapterId: selectedAdapter!.id,
                    config: data.config,
                    primaryCredentialId,
                    sshCredentialId,
                }),
            });
            const testResult = await testRes.json();
            toast.dismiss(toastId);

            if (testResult.success) {
                toast.success("Connection test successful");
                await saveConfig(data);
            } else {
                setConnectionError(testResult.message || "Connection test failed");
                setPendingSubmission(data);
            }
        } catch {
            toast.dismiss(toastId);
            setConnectionError("Could not test connection due to an unexpected error.");
            setPendingSubmission(data);
        }
    };

    // If source already saved, show success state
    if (isSaved) {
        return (
            <div className="space-y-6">
                <div className="text-center space-y-4 py-8">
                    <div className="mx-auto w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center">
                        <CheckCircle2 className="h-8 w-8 text-green-500" />
                    </div>
                    <h3 className="text-xl font-semibold">Database Source Created</h3>
                    <p className="text-muted-foreground">
                        <strong>{wizardData.sourceName}</strong> has been configured successfully.
                    </p>
                </div>
                <div className="flex justify-between pt-4">
                    <Button variant="outline" onClick={onPrev}>
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Back
                    </Button>
                    <Button onClick={onNext}>
                        Continue
                        <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                </div>
            </div>
        );
    }

    // Step 1: Pick adapter type
    if (!selectedAdapter) {
        return (
            <div className="space-y-6">
                <div className="space-y-2">
                    <div className="flex items-center gap-2">
                        <Database className="h-5 w-5 text-primary" />
                        <h3 className="text-lg font-semibold">Choose your Database Type</h3>
                    </div>
                    <p className="text-sm text-muted-foreground">
                        Select the type of database you want to back up.
                    </p>
                </div>
                <AdapterPicker adapters={adapters} onSelect={handleAdapterSelect} />
                <div className="flex justify-start pt-4">
                    <Button variant="outline" onClick={onPrev}>
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Back
                    </Button>
                </div>
            </div>
        );
    }

    // Step 2: Configure the selected adapter
    return (
        <>
            <div className="space-y-6" {...toneAttribute("create")}>
                <div className="space-y-2">
                    <div className="flex items-center gap-2">
                        <Database className="h-5 w-5 text-primary" />
                        <h3 className="text-lg font-semibold">Configure {selectedAdapter.name} Source</h3>
                    </div>
                    <p className="text-sm text-muted-foreground">
                        Enter the connection details for your database.
                    </p>
                </div>

                <Form {...form}>
                    <FormProvider {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                            {/* Name field */}
                            <FormField
                                control={form.control}
                                name="name"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Name</FormLabel>
                                        <FormControl>
                                            <Input placeholder="My Production Database" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            {/* Type badge + connection mode selector */}
                            <div className="flex w-full gap-4 items-start">
                                <div className="space-y-1 flex-1">
                                    <span className="text-sm font-medium">Type</span>
                                    <div>
                                        <Badge variant="secondary" className="text-sm py-1.5 px-3">
                                            {selectedAdapter.name}
                                        </Badge>
                                        <Button
                                            type="button"
                                            variant="link"
                                            size="sm"
                                            className="ml-2 text-xs"
                                            onClick={() => {
                                                setSelectedAdapter(null);
                                                form.reset({ name: "", config: {} });
                                            }}
                                        >
                                            Change
                                        </Button>
                                    </div>
                                </div>
                                {/* Mode selector for SQLite */}
                                {selectedAdapter.id === "sqlite" && (
                                    <div className="w-1/2">
                                        <SchemaField
                                            name="config.mode"
                                            fieldKey="mode"
                                            schemaShape={(selectedAdapter.configSchema as z.ZodObject<Record<string, z.ZodTypeAny>>).shape.mode}
                                            adapterId="sqlite"
                                        />
                                    </div>
                                )}
                                {/* Connection mode selector for SSH-capable adapters */}
                                {selectedAdapter.id !== "sqlite" && (selectedAdapter.configSchema as z.ZodObject<Record<string, z.ZodTypeAny>>).shape?.connectionMode && (
                                    <div className="w-1/2">
                                        <SchemaField
                                            name="config.connectionMode"
                                            fieldKey="connectionMode"
                                            schemaShape={(selectedAdapter.configSchema as z.ZodObject<Record<string, z.ZodTypeAny>>).shape.connectionMode}
                                            adapterId={selectedAdapter.id}
                                        />
                                    </div>
                                )}
                            </div>

                            {/* Dynamic form content */}
                            <DatabaseFormContent
                                adapter={selectedAdapter}
                                detectedVersion={detectedVersion}
                                primaryCredentialId={primaryCredentialId}
                                sshCredentialId={sshCredentialId}
                                onPrimaryChange={setPrimaryCredentialId}
                                onSshChange={setSshCredentialId}
                            />

                            {/* Actions */}
                            <div className="flex flex-col-reverse sm:flex-row sm:justify-between gap-2 pt-4">
                                <Button type="button" variant="outline" onClick={() => setSelectedAdapter(null)}>
                                    <ArrowLeft className="mr-2 h-4 w-4" />
                                    Back to Selection
                                </Button>
                                <div className="flex gap-2">
                                    <Button type="button" variant="secondary" onClick={testConnection}>
                                        Test Connection
                                    </Button>
                                    <Button type="submit">
                                        Save & Continue
                                        <ArrowRight className="ml-2 h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                        </form>
                    </FormProvider>
                </Form>
            </div>

            {/* Connection Error Dialog */}
            <AlertDialog open={!!connectionError} onOpenChange={(open) => !open && setConnectionError(null)}>
                <AlertDialogContent tone="warning">
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
                        <AlertDialogCancel
                            onClick={() => {
                                setConnectionError(null);
                                setPendingSubmission(null);
                            }}
                        >
                            Cancel, let me fix it
                        </AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => {
                                setConnectionError(null);
                                if (pendingSubmission) {
                                    saveConfig(pendingSubmission as { name: string; config: Record<string, unknown> });
                                }
                            }}
                        >
                            Save Anyway
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}
