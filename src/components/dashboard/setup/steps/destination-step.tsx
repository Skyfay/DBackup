"use client";

import { useState, useMemo } from "react";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, ArrowRight, HardDrive, CheckCircle2 } from "lucide-react";
import { AdapterDefinition } from "@/lib/adapters/definitions";
import { AdapterPicker } from "@/components/adapter/adapter-picker";
import { StorageFormContent } from "@/components/adapter/form-sections";
import { useAdapterConnection } from "@/components/adapter/use-adapter-connection";
import { WizardData } from "../setup-wizard";

interface DestinationStepProps {
    adapters: AdapterDefinition[];
    wizardData: WizardData;
    onUpdate: (data: Partial<WizardData>) => void;
    onNext: () => void;
    onPrev: () => void;
}

export function DestinationStep({ adapters, wizardData, onUpdate, onNext, onPrev }: DestinationStepProps) {
    const [selectedAdapter, setSelectedAdapter] = useState<AdapterDefinition | null>(null);
    const [isSaved, setIsSaved] = useState(!!wizardData.destinationId);
    const [primaryCredentialId, setPrimaryCredentialId] = useState<string | null>(null);
    const [sshCredentialId, setSshCredentialId] = useState<string | null>(null);

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

    const { testConnection } = useAdapterConnection({
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

    const onSubmit = async (data: { name: string; config: Record<string, unknown> }) => {
        try {
            const payload = {
                name: data.name,
                adapterId: selectedAdapter!.id,
                config: data.config,
                type: "storage",
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
                toast.success("Storage destination created successfully");
                onUpdate({
                    destinationId: result.id,
                    destinationName: data.name,
                });
                setIsSaved(true);
            } else {
                const errResult = await res.json().catch(() => null);
                toast.error(errResult?.error || "Failed to create destination");
            }
        } catch {
            toast.error("An error occurred while creating the destination");
        }
    };

    // If destination already saved, show success state
    if (isSaved) {
        return (
            <div className="space-y-6">
                <div className="text-center space-y-4 py-8">
                    <div className="mx-auto w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center">
                        <CheckCircle2 className="h-8 w-8 text-green-500" />
                    </div>
                    <h3 className="text-xl font-semibold">Storage Destination Created</h3>
                    <p className="text-muted-foreground">
                        <strong>{wizardData.destinationName}</strong> has been configured successfully.
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

    // Adapter selection
    if (!selectedAdapter) {
        return (
            <div className="space-y-6">
                <div className="space-y-2">
                    <div className="flex items-center gap-2">
                        <HardDrive className="h-5 w-5 text-primary" />
                        <h3 className="text-lg font-semibold">Choose your Storage Type</h3>
                    </div>
                    <p className="text-sm text-muted-foreground">
                        Select where you want to store your backups.
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

    // Configure selected adapter
    return (
        <div className="space-y-6">
            <div className="space-y-2">
                <div className="flex items-center gap-2">
                    <HardDrive className="h-5 w-5 text-primary" />
                    <h3 className="text-lg font-semibold">Configure {selectedAdapter.name} Destination</h3>
                </div>
                <p className="text-sm text-muted-foreground">
                    Enter the connection details for your storage destination.
                </p>
            </div>

            <Form {...form}>
                <FormProvider {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                        <FormField
                            control={form.control}
                            name="name"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Name</FormLabel>
                                    <FormControl>
                                        <Input placeholder="My Backup Storage" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <div className="space-y-1">
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

                        <StorageFormContent
                            adapter={selectedAdapter}
                            primaryCredentialId={primaryCredentialId}
                            sshCredentialId={sshCredentialId}
                            onPrimaryChange={setPrimaryCredentialId}
                            onSshChange={setSshCredentialId}
                        />

                        <div className="flex flex-col-reverse sm:flex-row sm:justify-between gap-2 pt-4">
                            <Button type="button" variant="outline" onClick={() => setSelectedAdapter(null)}>
                                <ArrowLeft className="mr-2 h-4 w-4" />
                                Back to Selection
                            </Button>
                            <div className="flex gap-2">
                                <Button type="button" variant="secondary" onClick={testConnection}>
                                    Test Connection
                                </Button>
                                <Button tone="create" type="submit">
                                    Save & Continue
                                    <ArrowRight className="ml-2 h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    </form>
                </FormProvider>
            </Form>
        </div>
    );
}
