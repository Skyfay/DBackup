"use client";

import { useState } from "react";
import { toast } from "sonner";
import { UseFormReturn } from "react-hook-form";

interface UseAdapterConnectionProps {
    adapterId: string;
    form: UseFormReturn<any>;
    onSuccess?: (data: any) => Promise<void>;
    initialDataId?: string;
}

export function useAdapterConnection({ adapterId, form, initialDataId }: UseAdapterConnectionProps) {
    const [connectionError, setConnectionError] = useState<string | null>(null);
    const [pendingSubmission, setPendingSubmission] = useState<any | null>(null);
    const [detectedVersion, setDetectedVersion] = useState<string | null>(null);
    const [availableDatabases, setAvailableDatabases] = useState<string[]>([]);
    const [isLoadingDbs, setIsLoadingDbs] = useState(false);
    const [isDbListOpen, setIsDbListOpen] = useState(false);

    const testConnection = async () => {
        const data = form.getValues();
        if (!data.adapterId) {
            toast.error("Please select an adapter type first");
            return false;
        }

        const toastId = toast.loading("Testing connection...");
        try {
            const res = await fetch('/api/adapters/test-connection', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    adapterId: data.adapterId,
                    config: data.config,
                    configId: initialDataId
                })
            });
            const result = await res.json();

            toast.dismiss(toastId);

            if (result.success) {
                toast.success(result.message || "Connection successful");
                if (result.version) {
                    setDetectedVersion(result.version);
                }
                return true;
            } else {
                toast.error(result.message || "Connection failed");
                return false;
            }
        } catch (_e) {
            toast.dismiss(toastId);
            toast.error("Failed to test connection");
            return false;
        }
    };

    const fetchDatabases = async (currentConfig: any) => {
        if (!adapterId) return;

        setIsLoadingDbs(true);
        try {
            // First check connection
             const testRes = await fetch('/api/adapters/test-connection', {
                 method: 'POST',
                 headers: { 'Content-Type': 'application/json' },
                 body: JSON.stringify({ adapterId: adapterId, config: currentConfig })
             });
             const testResult = await testRes.json();

             if (!testResult.success) {
                 toast.error(`Connection failed: ${testResult.message}`);
                 setAvailableDatabases([]);
                 setIsLoadingDbs(false);
                 return;
             }

             // Then fetch access
             const res = await fetch('/api/adapters/access-check', {
                 method: 'POST',
                 headers: { 'Content-Type': 'application/json' },
                 body: JSON.stringify({ adapterId: adapterId, config: currentConfig })
             });
             const data = await res.json();

             if(data.success) {
                 const newDbs = data.databases;
                 setAvailableDatabases(newDbs);
                 setConnectionError(null);

                 // Sync Logic
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

    return {
        connectionError,
        setConnectionError,
        pendingSubmission,
        setPendingSubmission,
        detectedVersion,
        availableDatabases,
        isLoadingDbs,
        isDbListOpen,
        setIsDbListOpen,
        testConnection,
        fetchDatabases
    };
}
