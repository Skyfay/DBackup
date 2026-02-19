"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form";
import { toast } from "sonner";
import { updateRateLimitSettings, resetRateLimitSettings } from "@/app/actions/rate-limit-settings";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Shield, Globe, PenLine, RotateCcw, Info } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useRef, useCallback, useState } from "react";
import type { RateLimitConfig } from "@/lib/rate-limit";
import { RATE_LIMIT_DEFAULTS } from "@/lib/rate-limit";

const formSchema = z.object({
    authPoints: z.coerce.number().min(1, "Min 1").max(1000, "Max 1000"),
    authDuration: z.coerce.number().min(10, "Min 10s").max(3600, "Max 3600s"),
    apiPoints: z.coerce.number().min(1, "Min 1").max(10000, "Max 10000"),
    apiDuration: z.coerce.number().min(10, "Min 10s").max(3600, "Max 3600s"),
    mutationPoints: z.coerce.number().min(1, "Min 1").max(1000, "Max 1000"),
    mutationDuration: z.coerce.number().min(10, "Min 10s").max(3600, "Max 3600s"),
});

interface RateLimitSettingsProps {
    initialConfig: RateLimitConfig;
}

export function RateLimitSettings({ initialConfig }: RateLimitSettingsProps) {
    const [isResetting, setIsResetting] = useState(false);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema) as any,
        defaultValues: {
            authPoints: initialConfig.auth.points,
            authDuration: initialConfig.auth.duration,
            apiPoints: initialConfig.api.points,
            apiDuration: initialConfig.api.duration,
            mutationPoints: initialConfig.mutation.points,
            mutationDuration: initialConfig.mutation.duration,
        },
    });

    const handleAutoSave = useCallback((field: keyof z.infer<typeof formSchema>, value: number) => {
        // Update local state immediately
        form.setValue(field, value);

        // Debounce the save for number inputs (user may still be typing)
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            const currentValues = form.getValues();
            const dataToSave = { ...currentValues, [field]: value };

            toast.promise(updateRateLimitSettings(dataToSave), {
                loading: "Saving rate limits...",
                success: (result) => {
                    if (result.success) {
                        return "Rate limits saved";
                    } else {
                        throw new Error(result.error);
                    }
                },
                error: (err) => `Failed to save: ${err.message || "Unknown error"}`,
            });
        }, 800);
    }, [form]);

    async function handleReset() {
        setIsResetting(true);
        try {
            const result = await resetRateLimitSettings();
            if (result.success) {
                toast.success("Rate limits reset to defaults");
                form.reset({
                    authPoints: RATE_LIMIT_DEFAULTS.auth.points,
                    authDuration: RATE_LIMIT_DEFAULTS.auth.duration,
                    apiPoints: RATE_LIMIT_DEFAULTS.api.points,
                    apiDuration: RATE_LIMIT_DEFAULTS.api.duration,
                    mutationPoints: RATE_LIMIT_DEFAULTS.mutation.points,
                    mutationDuration: RATE_LIMIT_DEFAULTS.mutation.duration,
                });
            } else {
                toast.error(result.error || "Failed to reset settings");
            }
        } catch {
            toast.error("Failed to reset settings");
        } finally {
            setIsResetting(false);
        }
    }

    return (
        <Form {...form}>
            <div className="space-y-6">
                <Alert>
                    <Info className="h-4 w-4" />
                    <AlertDescription>
                        Rate limits restrict the number of requests per IP address within a time window.
                        Changes take effect immediately and reset all active rate limit counters.
                    </AlertDescription>
                </Alert>

                {/* Authentication Rate Limit */}
                <Card>
                    <CardHeader>
                        <div className="flex items-center gap-2">
                            <Shield className="h-5 w-5 text-muted-foreground" />
                            <CardTitle>Authentication</CardTitle>
                        </div>
                        <CardDescription>
                            Rate limit for login attempts (/api/auth/sign-in). Protects against brute-force attacks.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <FormField
                                control={form.control}
                                name="authPoints"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Max Requests</FormLabel>
                                        <FormControl>
                                            <Input
                                                type="number"
                                                min={1}
                                                max={1000}
                                                {...field}
                                                onChange={(e) => {
                                                    field.onChange(e);
                                                    const val = parseInt(e.target.value, 10);
                                                    if (!isNaN(val) && val >= 1) handleAutoSave("authPoints", val);
                                                }}
                                            />
                                        </FormControl>
                                        <FormDescription>
                                            Default: {RATE_LIMIT_DEFAULTS.auth.points}
                                        </FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="authDuration"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Time Window (seconds)</FormLabel>
                                        <FormControl>
                                            <Input
                                                type="number"
                                                min={10}
                                                max={3600}
                                                {...field}
                                                onChange={(e) => {
                                                    field.onChange(e);
                                                    const val = parseInt(e.target.value, 10);
                                                    if (!isNaN(val) && val >= 10) handleAutoSave("authDuration", val);
                                                }}
                                            />
                                        </FormControl>
                                        <FormDescription>
                                            Default: {RATE_LIMIT_DEFAULTS.auth.duration}s
                                        </FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>
                    </CardContent>
                </Card>

                {/* API Rate Limit */}
                <Card>
                    <CardHeader>
                        <div className="flex items-center gap-2">
                            <Globe className="h-5 w-5 text-muted-foreground" />
                            <CardTitle>API (Read)</CardTitle>
                        </div>
                        <CardDescription>
                            Rate limit for GET/HEAD requests to /api/* endpoints.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <FormField
                                control={form.control}
                                name="apiPoints"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Max Requests</FormLabel>
                                        <FormControl>
                                            <Input
                                                type="number"
                                                min={1}
                                                max={10000}
                                                {...field}
                                                onChange={(e) => {
                                                    field.onChange(e);
                                                    const val = parseInt(e.target.value, 10);
                                                    if (!isNaN(val) && val >= 1) handleAutoSave("apiPoints", val);
                                                }}
                                            />
                                        </FormControl>
                                        <FormDescription>
                                            Default: {RATE_LIMIT_DEFAULTS.api.points}
                                        </FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="apiDuration"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Time Window (seconds)</FormLabel>
                                        <FormControl>
                                            <Input
                                                type="number"
                                                min={10}
                                                max={3600}
                                                {...field}
                                                onChange={(e) => {
                                                    field.onChange(e);
                                                    const val = parseInt(e.target.value, 10);
                                                    if (!isNaN(val) && val >= 10) handleAutoSave("apiDuration", val);
                                                }}
                                            />
                                        </FormControl>
                                        <FormDescription>
                                            Default: {RATE_LIMIT_DEFAULTS.api.duration}s
                                        </FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>
                    </CardContent>
                </Card>

                {/* Mutation Rate Limit */}
                <Card>
                    <CardHeader>
                        <div className="flex items-center gap-2">
                            <PenLine className="h-5 w-5 text-muted-foreground" />
                            <CardTitle>API (Write)</CardTitle>
                        </div>
                        <CardDescription>
                            Rate limit for POST/PUT/DELETE requests to /api/* endpoints.
                            Protects against audit log flooding and spam.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <FormField
                                control={form.control}
                                name="mutationPoints"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Max Requests</FormLabel>
                                        <FormControl>
                                            <Input
                                                type="number"
                                                min={1}
                                                max={1000}
                                                {...field}
                                                onChange={(e) => {
                                                    field.onChange(e);
                                                    const val = parseInt(e.target.value, 10);
                                                    if (!isNaN(val) && val >= 1) handleAutoSave("mutationPoints", val);
                                                }}
                                            />
                                        </FormControl>
                                        <FormDescription>
                                            Default: {RATE_LIMIT_DEFAULTS.mutation.points}
                                        </FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="mutationDuration"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Time Window (seconds)</FormLabel>
                                        <FormControl>
                                            <Input
                                                type="number"
                                                min={10}
                                                max={3600}
                                                {...field}
                                                onChange={(e) => {
                                                    field.onChange(e);
                                                    const val = parseInt(e.target.value, 10);
                                                    if (!isNaN(val) && val >= 10) handleAutoSave("mutationDuration", val);
                                                }}
                                            />
                                        </FormControl>
                                        <FormDescription>
                                            Default: {RATE_LIMIT_DEFAULTS.mutation.duration}s
                                        </FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>
                    </CardContent>
                </Card>

                {/* Reset to Defaults */}
                <div className="flex items-center">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={handleReset}
                        disabled={isResetting}
                    >
                        <RotateCcw className="mr-2 h-4 w-4" />
                        {isResetting ? "Resetting..." : "Reset to Defaults"}
                    </Button>
                </div>
            </div>
        </Form>
    );
}
