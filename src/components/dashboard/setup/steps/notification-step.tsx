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
import { Badge } from "@/components/ui/badge";
import {
    ArrowLeft,
    ArrowRight,
    Bell,
    CheckCircle2,
    SkipForward,
} from "lucide-react";
import { AdapterDefinition } from "@/lib/adapters/definitions";
import { AdapterPicker } from "@/components/adapter/adapter-picker";
import { NotificationFormContent } from "@/components/adapter/form-sections";
import { useAdapterConnection } from "@/components/adapter/use-adapter-connection";
import { WizardData } from "../setup-wizard";

interface NotificationStepProps {
    adapters: AdapterDefinition[];
    wizardData: WizardData;
    onUpdate: (data: Partial<WizardData>) => void;
    onNext: () => void;
    onPrev: () => void;
    onSkip: () => void;
}

export function NotificationStep({
    adapters,
    wizardData,
    onUpdate,
    onNext,
    onPrev,
    onSkip,
}: NotificationStepProps) {
    const [selectedAdapter, setSelectedAdapter] = useState<AdapterDefinition | null>(null);
    const [isSaved, setIsSaved] = useState(wizardData.notificationIds.length > 0);
    const [primaryCredentialId, setPrimaryCredentialId] = useState<string | null>(null);

    // Patch schema: make credential-managed fields optional so hidden inputs
    // don't cause silent required-field validation failures.
    const configSchema = useMemo(() => {
        if (!selectedAdapter) return z.any();
        const base = selectedAdapter.configSchema;
        if (!(base instanceof z.ZodObject)) return base;
        const keys: string[] = [];
        if (selectedAdapter.credentials?.primary === "USERNAME_PASSWORD") keys.push("user", "username", "password");
        if (selectedAdapter.credentials?.primary === "TOKEN") keys.push("token", "appToken", "accessToken", "botToken");
        if (selectedAdapter.credentials?.primary === "SMTP") keys.push("user", "password");
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
    });

    const handleAdapterSelect = (adapter: AdapterDefinition) => {
        setSelectedAdapter(adapter);
        form.reset({ name: "", config: {} });
        setPrimaryCredentialId(null);
        setIsSaved(false);
    };

    const onSubmit = async (data: { name: string; config: Record<string, unknown> }) => {
        try {
            const payload = {
                name: data.name,
                adapterId: selectedAdapter!.id,
                config: data.config,
                type: "notification",
                primaryCredentialId,
            };

            const res = await fetch("/api/adapters", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            if (res.ok) {
                const result = await res.json();
                toast.success("Notification channel created successfully");
                onUpdate({
                    notificationIds: [...wizardData.notificationIds, result.id],
                    notificationNames: [...wizardData.notificationNames, data.name],
                });
                setIsSaved(true);
            } else {
                const errResult = await res.json().catch(() => null);
                toast.error(errResult?.error || "Failed to create notification channel");
            }
        } catch {
            toast.error("An error occurred while creating the notification channel");
        }
    };

    // Already saved
    if (isSaved) {
        return (
            <div className="space-y-6">
                <div className="text-center space-y-4 py-8">
                    <div className="mx-auto w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center">
                        <CheckCircle2 className="h-8 w-8 text-green-500" />
                    </div>
                    <h3 className="text-xl font-semibold">Notification Channel Created</h3>
                    <p className="text-muted-foreground">
                        <strong>{wizardData.notificationNames.join(", ")}</strong> will be used
                        for backup alerts.
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
                        <Bell className="h-5 w-5 text-primary" />
                        <h3 className="text-lg font-semibold">Set Up Notifications</h3>
                    </div>
                    <p className="text-sm text-muted-foreground">
                        Get notified about backup results. Choose a notification channel below, or skip this step.
                    </p>
                </div>
                <AdapterPicker adapters={adapters} onSelect={handleAdapterSelect} />
                <div className="flex justify-between pt-4">
                    <Button variant="outline" onClick={onPrev}>
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Back
                    </Button>
                    <Button variant="ghost" onClick={onSkip}>
                        <SkipForward className="mr-2 h-4 w-4" />
                        Skip
                    </Button>
                </div>
            </div>
        );
    }

    // Configure selected adapter
    return (
        <div className="space-y-6" {...toneAttribute("create")}>
            <div className="space-y-2">
                <div className="flex items-center gap-2">
                    <Bell className="h-5 w-5 text-primary" />
                    <h3 className="text-lg font-semibold">Configure {selectedAdapter.name}</h3>
                </div>
                <p className="text-sm text-muted-foreground">
                    Enter the details for your notification channel.
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
                                        <Input placeholder="My Notification Channel" {...field} />
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

                        <NotificationFormContent
                            adapter={selectedAdapter}
                            primaryCredentialId={primaryCredentialId}
                            onPrimaryChange={setPrimaryCredentialId}
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
    );
}
