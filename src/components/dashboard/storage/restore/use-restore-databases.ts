"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AdapterOption } from "@/components/dashboard/jobs/job-form-schema";
import type { FileInfo } from "@/components/dashboard/storage/file-info";
import { getAdapterDefinition } from "@/lib/adapters/definitions";
import { compareVersions } from "@/lib/utils";
import { buildDbRows, copyName, type DbChoice, type ServerDatabase } from "./restore-model";

/** Adapters that run a server DBackup can list the databases of. The rest restore into a file, like SQLite. */
const SERVER_ADAPTERS = ["mysql", "mariadb", "postgres", "mongodb", "mssql", "azure-sql", "redis", "valkey", "firebird"];

/** Whether the picked server can take the backup, and what the page says about it. */
export interface Compatibility {
    ok: boolean;
    text: string;
}

interface ServerState {
    /** The connection it was read from, so a server picked a moment ago never shows the last one. */
    id: string;
    databases: ServerDatabase[];
    version?: string;
    edition?: string;
    /** Why DBackup could not connect to it, like an address that refuses. */
    problem?: string;
}

interface StatsAnswer {
    success?: boolean;
    message?: string;
    databases?: ServerDatabase[];
    serverVersion?: string;
    serverEdition?: string;
}

const UNREACHABLE = "It did not answer.";

/** A connection that can take a backup of this type, and that nobody has closed for restores. */
function canTake(option: AdapterOption, type: string): boolean {
    try {
        if (option.metadata && JSON.parse(option.metadata).isRestoreExcluded) return false;
    } catch {
        // Metadata that cannot be read does not close the connection.
    }
    if (!type) return true;
    const adapter = option.adapterId.toLowerCase();
    if (type === "mysql" || type === "mariadb") return adapter === "mysql" || adapter === "mariadb";
    return adapter === type;
}

/**
 * The databases of a backup and the server they go to: the servers that can take them, what
 * that server has now, whether its version fits, and the name each database gets there. Every
 * database starts ticked, or only the ones in `picked` when the backup holds one of them, like a
 * restore started from a day of the Database Explorer.
 */
export function useRestoreDatabases(file: FileInfo | null, analyzed: string[], sizes: Map<string, number>, sourceType: string, picked: string[] = []) {
    const type = sourceType.toLowerCase();
    const engine = getAdapterDefinition(type)?.name ?? sourceType;
    const isServer = SERVER_ADAPTERS.includes(type);
    // A Firebird target is a path, and Firebird cannot list its databases.
    const isFirebird = type === "firebird";

    const [connections, setConnections] = useState<AdapterOption[] | null>(null);
    const [target, setTarget] = useState("");
    const [server, setServer] = useState<ServerState | null>(null);
    const [loadingServer, setLoadingServer] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const [choices, setChoices] = useState<DbChoice[]>([]);
    // Older backups hold one dump without names. They take a single target name, or none for the original.
    const [classicName, setClassicName] = useState("");

    useEffect(() => {
        let ignore = false;
        fetch("/api/adapters?type=database")
            .then((res) => (res.ok ? res.json() : []))
            .then((data: AdapterOption[]) => !ignore && setConnections(data))
            .catch(() => !ignore && setConnections([]));
        return () => {
            ignore = true;
        };
    }, []);

    const pickedKey = picked.join("\u0000");
    useEffect(() => {
        const wanted = pickedKey ? pickedKey.split("\u0000") : [];
        const narrow = analyzed.some((name) => wanted.includes(name));
        setChoices(analyzed.map((name) => ({ id: name, name, targetName: name, selected: !narrow || wanted.includes(name) })));
    }, [analyzed, pickedKey]);

    useEffect(() => {
        if (!target) {
            setServer(null);
            return;
        }
        let ignore = false;
        setLoadingServer(true);
        fetch("/api/adapters/database-stats", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceId: target }) })
            .then((res) => res.json().catch(() => null) as Promise<StatsAnswer | null>)
            .then((data) => {
                if (ignore) return;
                // A server that cannot be reached says so right away, not first when the restore starts.
                if (!data?.success) {
                    setServer({ id: target, databases: [], problem: data?.message || UNREACHABLE });
                    return;
                }
                const databases = data.databases ?? [];
                setServer({ id: target, databases, version: data.serverVersion, edition: data.serverEdition });
                // A Firebird target is the path of the alias, filled in once the server names it.
                if (isFirebird) {
                    setChoices((current) => current.map((choice) => {
                        if (choice.targetName !== choice.name) return choice;
                        const match = databases.find((database) => database.name === choice.name);
                        return match?.path ? { ...choice, targetName: match.path } : choice;
                    }));
                }
            })
            .catch(() => !ignore && setServer({ id: target, databases: [], problem: UNREACHABLE }))
            .finally(() => !ignore && setLoadingServer(false));
        return () => {
            ignore = true;
        };
    }, [target, isFirebird, attempt]);

    // The server as it answered for the connection picked now, nothing while that is still open.
    const answered = server && server.id === target && !loadingServer ? server : null;
    const problem = answered?.problem ?? null;
    /** The picked server answered, so the databases can show what happens to each there. */
    const ready = answered !== null && problem === null;
    const retryServer = useCallback(() => setAttempt((count) => count + 1), []);

    const options = useMemo(() => (connections ?? []).filter((option) => canTake(option, type)), [connections, type]);

    const compatibility = useMemo<Compatibility | null>(() => {
        if (!file || !answered?.version) return null;
        if (file.engineVersion && compareVersions(file.engineVersion, answered.version) > 0) {
            return { ok: false, text: `The backup comes from ${engine} ${file.engineVersion}, the server runs ${answered.version}. DBackup does not restore a newer backup onto an older server.` };
        }
        if (type === "mssql" && file.engineEdition && answered.edition && (file.engineEdition === "Azure SQL Edge") !== (answered.edition === "Azure SQL Edge")) {
            return { ok: false, text: `A backup of ${file.engineEdition} cannot be restored onto ${answered.edition}, they are not compatible.` };
        }
        if (!file.engineVersion) return null;
        return compareVersions(file.engineVersion, answered.version) === 0
            ? { ok: true, text: `Same version as the backup, ${engine} ${answered.version}` }
            : { ok: true, text: `${engine} ${file.engineVersion} into the newer ${answered.version}` };
    }, [file, answered, engine, type]);

    const rows = useMemo(() => buildDbRows(choices, answered?.databases ?? [], sizes, isFirebird), [choices, answered, sizes, isFirebird]);

    const setPicked = useCallback((ids: string[], selected: boolean) => {
        const picked = new Set(ids);
        setChoices((current) => current.map((choice) => (picked.has(choice.id) ? { ...choice, selected } : choice)));
    }, []);

    const rename = useCallback((id: string, targetName: string) => {
        setChoices((current) => current.map((choice) => (choice.id === id ? { ...choice, targetName } : choice)));
    }, []);

    /** Restores these beside what the server has, each under a free name like shop_restored. */
    const asCopies = useCallback((ids: string[]) => {
        setChoices((current) => {
            const chosen = new Set(ids);
            const taken = new Set([...(answered?.databases ?? []).map((database) => database.name), ...current.filter((choice) => !chosen.has(choice.id)).map((choice) => choice.targetName)]);
            return current.map((choice) => {
                if (!chosen.has(choice.id)) return choice;
                const name = copyName(choice.name, taken);
                taken.add(name);
                return { ...choice, targetName: name, selected: true };
            });
        });
    }, [answered]);

    /** Back to the names they have in the backup. */
    const ownNames = useCallback((ids: string[]) => {
        const chosen = new Set(ids);
        setChoices((current) => current.map((choice) => (chosen.has(choice.id) ? { ...choice, targetName: choice.name } : choice)));
    }, []);

    return {
        engine, isServer, isFirebird, options, connectionsLoaded: connections !== null, target, setTarget, server: answered, loadingServer,
        problem, ready, retryServer, compatibility, choices, rows, setPicked, rename, asCopies, ownNames, classicName, setClassicName,
    };
}

export type RestoreDatabases = ReturnType<typeof useRestoreDatabases>;
