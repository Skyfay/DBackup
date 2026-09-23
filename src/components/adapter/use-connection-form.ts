"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import type { AdapterDefinition } from "@/lib/adapters/definitions";
import type { StorageRole } from "@/lib/core/storage-roles";
import type { CredentialProfileSummary } from "@/components/settings/credential-profile-dialog";
import type { AdapterConfig } from "./types";
import { buildConnectionFormSchema, type ConnectionFormValues } from "./connection-form-schema";
import { defaultConfig, fillRequiredText, initialRole, parseObject } from "./connection-form-defaults";

export type ConnectionTestState =
    | { status: "idle" }
    | { status: "running" }
    | { status: "passed"; version?: string }
    | { status: "failed"; message: string };

/** Switches a connection keeps in its metadata instead of its config, stored the way the API expects them. */
export interface ConnectionMetadata {
    healthNotificationsDisabled: boolean;
    /** Databases only. */
    isRestoreExcluded: boolean;
    /** Backup destinations only. */
    skipVerification: boolean;
}

/** What every part of the form gets to work with, whatever it shows. */
export interface ConnectionSectionProps {
    adapter: AdapterDefinition;
    primaryCredentialId: string | null;
    onPrimaryChange: (id: string | null) => void;
    sshCredentialId: string | null;
    onSshChange: (id: string | null) => void;
    metadata: ConnectionMetadata;
    onMetadataChange: (metadata: ConnectionMetadata) => void;
    storageRole: StorageRole;
    onStorageRoleChange: (role: StorageRole) => void;
    /** Whether the picked OAuth app holds a token for its cloud drive. */
    authorized: boolean;
    onPrimaryProfile: (profile: CredentialProfileSummary | null) => void;
    /** Goes up after an authorization, so the login field loads its profile again. */
    credentialRefreshKey: number;
    onAuthorized: () => void;
}

interface TestResponse {
    success: boolean;
    message?: string;
    version?: string;
}

interface Options {
    adapter: AdapterDefinition;
    initialData?: AdapterConfig;
    /** The role a new storage connection starts in, from the page it is added on. */
    defaultRole?: StorageRole;
    onSaved: () => void;
}

/**
 * The state behind the connection form: values, profiles, the connection test and saving.
 *
 * A database is tested before it is created, and a failed test asks whether to save anyway.
 */
export function useConnectionForm({ adapter, initialData, defaultRole, onSaved }: Options) {
    const schema = useMemo(() => buildConnectionFormSchema(adapter), [adapter]);
    const form = useForm<ConnectionFormValues>({
        resolver: zodResolver(schema) as unknown as Resolver<ConnectionFormValues>,
        defaultValues: {
            name: initialData?.name ?? "",
            adapterId: adapter.id,
            config: fillRequiredText(adapter, initialData ? parseObject(initialData.config) : defaultConfig(adapter)),
        },
        // The form moves to the part with the error itself. Focusing a field in a hidden part fails.
        shouldFocusError: false,
    });

    const storedMetadata = useMemo(() => parseObject(initialData?.metadata), [initialData?.metadata]);
    const [metadata, setMetadata] = useState<ConnectionMetadata>({
        healthNotificationsDisabled: storedMetadata.healthNotificationsDisabled === true,
        isRestoreExcluded: storedMetadata.isRestoreExcluded === true,
        skipVerification: storedMetadata.skipVerification === true,
    });
    const [storageRole, setStorageRole] = useState<StorageRole>(() => initialRole(adapter, initialData, defaultRole));
    const [primaryCredentialId, setPrimaryCredentialId] = useState<string | null>(initialData?.primaryCredentialId ?? null);
    const [sshCredentialId, setSshCredentialId] = useState<string | null>(initialData?.sshCredentialId ?? null);
    // OAuth authorization lives on the credential profile, so the picked profile says whether
    // it is authorized, even before the connection itself is saved.
    const [primaryProfile, setPrimaryProfile] = useState<CredentialProfileSummary | null>(null);
    const [credentialRefreshKey, setCredentialRefreshKey] = useState(0);
    const authorized = primaryProfile?.id === primaryCredentialId && primaryProfile?.secretStatus?.refreshToken === true;
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

    /** The flags this type of connection has, on top of whatever else the metadata holds. */
    const metadataToSave = (): Record<string, unknown> => {
        if (adapter.type === "database") {
            return { ...storedMetadata, healthNotificationsDisabled: metadata.healthNotificationsDisabled, isRestoreExcluded: metadata.isRestoreExcluded };
        }
        if (adapter.type === "storage") {
            return { ...storedMetadata, healthNotificationsDisabled: metadata.healthNotificationsDisabled, skipVerification: metadata.skipVerification };
        }
        return storedMetadata;
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
                    metadata: metadataToSave(),
                    primaryCredentialId,
                    sshCredentialId,
                    ...(adapter.type === "storage" ? { storageRole } : {}),
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

    const sectionProps: ConnectionSectionProps = {
        adapter,
        primaryCredentialId,
        onPrimaryChange: setPrimaryCredentialId,
        sshCredentialId,
        onSshChange: setSshCredentialId,
        metadata,
        onMetadataChange: setMetadata,
        storageRole,
        onStorageRoleChange: setStorageRole,
        authorized,
        onPrimaryProfile: setPrimaryProfile,
        credentialRefreshKey,
        onAuthorized: () => setCredentialRefreshKey((key) => key + 1),
    };

    return {
        form,
        sectionProps,
        storageRole,
        authorized,
        primaryCredentialId,
        sshCredentialId,
        test,
        runTest,
        onValid,
        failure,
        dismissFailure: () => setFailure(null),
        saveAnyway,
        saving,
    };
}
