"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { getExcludePatternPresets, getNotificationTemplates } from "@/app/actions/templates";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { jobDefaults, jobSchema, parsePgMajorVersion, toJobPayload, type AdapterOption, type JobFormJob, type JobFormValues } from "./job-form-schema";

const log = logger.child({ hook: "use-job-form" });

interface Options {
    sources: AdapterOption[];
    initialData: JobFormJob | null;
    onSaved: () => void;
}

/**
 * The state behind the job form: its values, the rules between them and saving.
 *
 * A PostgreSQL dump compresses itself, so the compression of DBackup is switched off for a job
 * that only backs up such a database, and the native algorithms its version lacks are refused.
 */
export function useJobForm({ sources, initialData, onSaved }: Options) {
    const form = useForm<JobFormValues>({
        resolver: zodResolver(jobSchema),
        defaultValues: jobDefaults(initialData),
        // The form moves to the part with the error itself. Focusing a field in a hidden part fails.
        shouldFocusError: false,
    });

    const sourceId = form.watch("sourceId");
    const sourceMode = form.watch("sourceMode");
    const pgAlgo = form.watch("pgCompressionAlgo");
    const source = useMemo(() => sources.find((option) => option.id === sourceId), [sources, sourceId]);
    const isPostgres = sourceMode !== "dirs" && source?.adapterId === "postgres";
    const pgMajorVersion = isPostgres ? parsePgMajorVersion(source?.metadata) : null;
    const nativeCompression = isPostgres && pgAlgo !== "NONE";

    // A dump that compresses itself is not compressed a second time. Folders beside it still are.
    useEffect(() => {
        if (nativeCompression && sourceMode === "db") form.setValue("compression", "NONE");
    }, [nativeCompression, sourceMode, form]);

    // A version that cannot do the picked algorithm falls back to the one every version can.
    useEffect(() => {
        if (!isPostgres || pgMajorVersion === null) return;
        const algo = form.getValues("pgCompressionAlgo");
        if ((algo === "LZ4" && pgMajorVersion < 14) || (algo === "ZSTD" && pgMajorVersion < 16)) {
            form.setValue("pgCompressionAlgo", "LEGACY", { shouldDirty: true });
            form.setValue("pgCompressionLevel", 6, { shouldDirty: true });
        }
    }, [isPostgres, pgMajorVersion, form]);

    // A new job starts with the default notification template, an edited one keeps its own.
    useEffect(() => {
        if (initialData) return;
        getNotificationTemplates()
            .then((res) => {
                const preset = res.success ? res.data?.find((template) => template.isDefault) : undefined;
                if (preset && form.getValues("notificationTemplateIds").length === 0) form.setValue("notificationTemplateIds", [preset.id]);
            })
            .catch((error: unknown) => log.warn("Notification templates could not be loaded", {}, wrapError(error)));
    }, [initialData, form]);

    // Exclude presets starred as default apply to folders added from here on. A folder the job has
    // already keeps its own, so editing never changes what a job leaves out behind the user's back.
    const [defaultExcludePresetIds, setDefaultExcludePresetIds] = useState<string[]>([]);
    useEffect(() => {
        getExcludePatternPresets()
            .then((res) => {
                if (res.success && res.data) setDefaultExcludePresetIds(res.data.filter((preset) => preset.isDefault).map((preset) => preset.id));
            })
            .catch((error: unknown) => log.warn("Exclude presets could not be loaded", {}, wrapError(error)));
    }, []);

    const save = async (values: JobFormValues) => {
        try {
            const res = await fetch(initialData ? `/api/jobs/${encodeURIComponent(initialData.id)}` : "/api/jobs", {
                method: initialData ? "PUT" : "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(toJobPayload(values, source?.adapterId)),
            });
            if (res.ok) {
                toast.success(initialData ? "Changes saved" : "Job created");
                onSaved();
                return;
            }
            const body = await res.json().catch(() => null);
            toast.error(body?.error || "The job could not be saved.");
        } catch (error) {
            log.error("Saving a job failed", { jobId: initialData?.id }, wrapError(error));
            toast.error("The job could not be saved.");
        }
    };

    return { form, save, source, isPostgres, pgMajorVersion, nativeCompression, defaultExcludePresetIds };
}

export type JobFormState = ReturnType<typeof useJobForm>;
