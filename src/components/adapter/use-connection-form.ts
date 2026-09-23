"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import type { AdapterDefinition } from "@/lib/adapters/definitions";
import type { AdapterConfig } from "./types";
import { buildConnectionFormSchema, type ConnectionFormValues } from "./connection-form-schema";
import { seedSchemaDefaults } from "./schema-defaults";

export type ConnectionTestState =
    | { status: "idle" }
    | { status: "running" }
    | { status: "passed"; version?: string }
    | { status: "failed"; message: string };

/** Switches a connection keeps in its metadata instead of its config, stored the way the API expects them. */
export interface ConnectionMetadata {
    healthNotificationsDisabled: boolean;
    isRestoreExcluded: boolean;
}

interface TestResponse {
    success: boolean;
    message?: string;
    version?: string;
}

function parseObject(json: string | null | undefined): Record<string, unknown> {
    if (!json) return {};
    try {
        const value: unknown = JSON.parse(json);
        return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
    } catch {
        return {};
    }
}

function isList(node: unknown): boolean {
    let current = node as { _def?: { type?: string; innerType?: unknown } } | undefined;
    while (current?._def) {
        if (current._def.type === "array") return true;
        current = current._def.innerType as typeof current;
    }
    return false;
}

/**
 * A new connection starts with the defaults its schema declares, like the port, and with
 * an empty list where the schema wants one. Without it a required list such as the Firebird
 * aliases reports a missing value in Zod's words instead of its own message.
 */
function defaultConfig(adapter: AdapterDefinition): Record<string, unknown> {
    const config: Record<string, unknown> = {};
    const key = (name: string) => name.slice("config.".length);
    seedSchemaDefaults(adapter.configSchema, {
        getValues: (name) => config[key(name)],
        setValue: (name, value) => {
            config[key(name)] = value;
        },
    });
    const shape = adapter.configSchema.shape as Record<string, { safeParse: (value: unknown) => { success: boolean; data?: unknown } }>;
    for (const [name, node] of Object.entries(shape)) {
        if (config[name] === undefined && isList(node)) config[name] = [];
    }
    // `mode` only picks the layout for SQLite. For Redis it is an ordinary setting, standalone
    // or Sentinel, and the seeding above skips it by name.
    if (adapter.id !== "sqlite" && "mode" in shape && config.mode === undefined) {
        const parsed = shape.mode.safeParse(undefined);
        if (parsed.success && parsed.data !== undefined) config.mode = parsed.data;
    }
    return config;
}

interface Options {
    adapter: AdapterDefinition;
    initialData?: AdapterConfig;
    onSaved: () => void;
}

/**
 * The state behind the connection form: values, profiles, the connection test and saving.
 *
 * A database is tested before it is created, and a failed test asks whether to save anyway.
 */
export function useConnectionForm({ adapter, initialData, onSaved }: Options) {
    const schema = useMemo(() => buildConnectionFormSchema(adapter), [adapter]);
    const form = useForm<ConnectionFormValues>({
        resolver: zodResolver(schema) as unknown as Resolver<ConnectionFormValues>,
        defaultValues: {
            name: initialData?.name ?? "",
            adapterId: adapter.id,
            config: initialData ? parseObject(initialData.config) : defaultConfig(adapter),
        },
        // The form moves to the part with the error itself. Focusing a field in a hidden part fails.
        shouldFocusError: false,
    });

    const storedMetadata = useMemo(() => parseObject(initialData?.metadata), [initialData?.metadata]);
    const [metadata, setMetadata] = useState<ConnectionMetadata>({
        healthNotificationsDisabled: storedMetadata.healthNotificationsDisabled === true,
        isRestoreExcluded: storedMetadata.isRestoreExcluded === true,
    });
    const [primaryCredentialId, setPrimaryCredentialId] = useState<string | null>(initialData?.primaryCredentialId ?? null);
    const [sshCredentialId, setSshCredentialId] = useState<string | null>(initialData?.sshCredentialId ?? null);
    const [failure, setFailure] = useState<{ message: string; values: ConnectionFormValues } | null>(null);
    const [saving, setSaving] = useState(false);

    // A result only speaks for the values and the profiles it was reached with.
    const profiles = `${primaryCredentialId ?? ""}|${sshCredentialId ?? ""}`;
    const [testResult, setTestResult] = useState<{ state: ConnectionTestState; profiles: string }>({ state: { status: "idle" }, profiles });
    const test: ConnectionTestState = testResult.profiles === profiles ? testResult.state : { status: "idle" };
    const setTest = (state: ConnectionTestState) => setTestResult({ state, profiles });

    useEffect(() => {
        const subscription = form.watch(() =>
            setTestResult((current) => (current.state.status === "running" ? current : { ...current, state: { status: "idle" } }))
        );
        return () => subscription.unsubscribe();
    }, [form]);

    const requestTest = async (values: ConnectionFormValues): Promise<TestResponse> => {
        const res = await fetch("/api/adapters/test-connection", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                adapterId: adapter.id,
                config: values.config,
                configId: initialData?.id,
                primaryCredentialId,
                sshCredentialId,
            }),
        });
        return (await res.json()) as TestResponse;
    };

    /** The test button. A failure also goes to a toast, where the whole message fits. */
    const runTest = async () => {
        setTest({ status: "running" });
        try {
            const result = await requestTest(form.getValues());
            if (result.success) {
                setTest({ status: "passed", version: result.version });
            } else {
                const message = result.message || "Connection failed";
                setTest({ status: "failed", message });
                toast.error(message);
            }
        } catch {
            setTest({ status: "failed", message: "The connection could not be tested." });
            toast.error("The connection could not be tested.");
        }
    };

    const save = async (values: ConnectionFormValues) => {
        setSaving(true);
        try {
            const res = await fetch(initialData ? `/api/adapters/${initialData.id}` : "/api/adapters", {
                method: initialData ? "PUT" : "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: values.name,
                    adapterId: adapter.id,
                    type: adapter.type,
                    config: values.config,
                    // Keeps whatever else the metadata holds, like flags set elsewhere.
                    metadata: { ...storedMetadata, ...metadata },
                    primaryCredentialId,
                    sshCredentialId,
                }),
            });
            if (res.ok) {
                toast.success(initialData ? "Changes saved" : "Connection created");
                onSaved();
            } else {
                const result = await res.json().catch(() => null);
                toast.error(result?.error || "The connection could not be saved.");
            }
        } catch {
            toast.error("The connection could not be saved.");
        } finally {
            setSaving(false);
        }
    };

    /** Create or save. A database is tested first, since a source that cannot connect fails every job. */
    const onValid = async (values: ConnectionFormValues) => {
        if (adapter.type !== "database") return save(values);

        setTest({ status: "running" });
        try {
            const result = await requestTest(values);
            if (result.success) {
                setTest({ status: "passed", version: result.version });
                await save(values);
                return;
            }
            const message = result.message || "Connection failed";
            setTest({ status: "failed", message });
            setFailure({ message, values });
        } catch {
            setTest({ status: "failed", message: "The connection could not be tested." });
            setFailure({ message: "The connection could not be tested.", values });
        }
    };

    const saveAnyway = async () => {
        if (!failure) return;
        await save(failure.values);
        setFailure(null);
    };

    return {
        form,
        metadata,
        setMetadata,
        primaryCredentialId,
        setPrimaryCredentialId,
        sshCredentialId,
        setSshCredentialId,
        test,
        runTest,
        onValid,
        failure,
        dismissFailure: () => setFailure(null),
        saveAnyway,
        saving,
    };
}
