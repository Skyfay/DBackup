"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from "react";
import { ChevronRight, ChevronDown, Folder, Loader2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";

interface BrowseEntry {
    name: string;
    path: string;
}

/** Records how a fetched node relates to its parent - parentKey is "" for top-level entries. */
interface TreeNodeInfo {
    name: string;
    parentKey: string;
}

type NodeState = "checked" | "unchecked" | "indeterminate";

export interface DirectorySourceSelection {
    path: string;
    excludePatterns: string[];
}

export interface DirectoryTreeHandle {
    getSelection: () => DirectorySourceSelection[];
}

interface DirectoryTreeProps {
    configId: string;
    /** Fires whenever the number of included top-level folders changes, so the host dialog can enable/disable its confirm button. */
    onSelectionCountChange?: (count: number) => void;
}

/**
 * Synology-style checkbox folder tree, lazily loaded one level at a time via
 * GET /api/adapters/[id]/browse. Node identity uses whatever opaque `path` the browse
 * API returns for that adapter (a real path string for most adapters, a folder ID for
 * Google Drive) - hierarchy and final path reconstruction are derived from the
 * parent/child relationships recorded as each level is fetched, not from string
 * parsing of that identifier, so the same logic works for both cases.
 */
export const DirectoryTree = forwardRef<DirectoryTreeHandle, DirectoryTreeProps>(function DirectoryTree(
    { configId, onSelectionCountChange },
    ref
) {
    const [nodesByKey, setNodesByKey] = useState<Map<string, TreeNodeInfo>>(new Map());
    const [childrenByKey, setChildrenByKey] = useState<Map<string, string[] | "loading">>(new Map());
    const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
    const [includedRoots, setIncludedRoots] = useState<Set<string>>(new Set());
    const [excludedSubpaths, setExcludedSubpaths] = useState<Map<string, Set<string>>>(new Map());

    const fetchChildren = useCallback(async (parentKey: string) => {
        setChildrenByKey((prev) => new Map(prev).set(parentKey, "loading"));
        try {
            const res = await fetch(`/api/adapters/${encodeURIComponent(configId)}/browse?path=${encodeURIComponent(parentKey)}`);
            const json = await res.json();
            if (!json.success) {
                toast.error(json.error || "Failed to load folders");
                setChildrenByKey((prev) => new Map(prev).set(parentKey, []));
                return;
            }
            if (json.supported === false) {
                toast.error("This adapter does not support folder browsing");
                setChildrenByKey((prev) => new Map(prev).set(parentKey, []));
                return;
            }
            const entries: BrowseEntry[] = json.data?.entries ?? [];
            setNodesByKey((prev) => {
                const next = new Map(prev);
                for (const e of entries) next.set(e.path, { name: e.name, parentKey });
                return next;
            });
            setChildrenByKey((prev) => new Map(prev).set(parentKey, entries.map((e) => e.path)));
        } catch {
            toast.error("Network error while browsing folders");
            setChildrenByKey((prev) => new Map(prev).set(parentKey, []));
        }
    }, [configId]);

    useEffect(() => {
        fetchChildren("");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [configId]);

    useEffect(() => {
        onSelectionCountChange?.(includedRoots.size);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [includedRoots]);

    const getAncestorKeys = useCallback((key: string): string[] => {
        const result: string[] = [];
        let currentParent = nodesByKey.get(key)?.parentKey;
        while (currentParent !== undefined) {
            result.push(currentParent);
            if (currentParent === "") break;
            currentParent = nodesByKey.get(currentParent)?.parentKey;
        }
        return result;
    }, [nodesByKey]);

    const isDescendant = useCallback((key: string, ancestorKey: string): boolean => {
        return getAncestorKeys(key).includes(ancestorKey);
    }, [getAncestorKeys]);

    const getIncludedRootFor = useCallback((key: string): string | null => {
        if (includedRoots.has(key)) return key;
        for (const a of getAncestorKeys(key)) {
            if (a === "") continue;
            if (includedRoots.has(a)) return a;
        }
        return null;
    }, [includedRoots, getAncestorKeys]);

    const getNodeState = useCallback((key: string): NodeState => {
        const root = getIncludedRootFor(key);
        if (!root) return "unchecked";
        const excludes = excludedSubpaths.get(root) ?? new Set<string>();
        if (root === key) {
            return excludes.size > 0 ? "indeterminate" : "checked";
        }
        if (excludes.has(key)) return "unchecked";
        for (const a of getAncestorKeys(key)) {
            if (a === root) break;
            if (excludes.has(a)) return "unchecked";
        }
        for (const e of excludes) {
            if (e !== key && isDescendant(e, key)) return "indeterminate";
        }
        return "checked";
    }, [getIncludedRootFor, excludedSubpaths, getAncestorKeys, isDescendant]);

    const setChecked = useCallback((key: string) => {
        const root = getIncludedRootFor(key);
        if (root) {
            setExcludedSubpaths((prev) => {
                const next = new Map(prev);
                const excludes = new Set(next.get(root) ?? []);
                for (const e of Array.from(excludes)) {
                    if (e === key || isDescendant(e, key)) excludes.delete(e);
                }
                if (excludes.size > 0) next.set(root, excludes); else next.delete(root);
                return next;
            });
        } else {
            setIncludedRoots((prev) => {
                const next = new Set(prev);
                for (const r of Array.from(next)) {
                    if (r !== key && isDescendant(r, key)) next.delete(r);
                }
                next.add(key);
                return next;
            });
            setExcludedSubpaths((prev) => {
                const next = new Map(prev);
                next.delete(key);
                for (const rootKey of Array.from(next.keys())) {
                    if (rootKey !== key && isDescendant(rootKey, key)) next.delete(rootKey);
                }
                return next;
            });
        }
    }, [getIncludedRootFor, isDescendant]);

    const setUnchecked = useCallback((key: string) => {
        const root = getIncludedRootFor(key);
        if (!root) return;
        if (root === key) {
            setIncludedRoots((prev) => { const next = new Set(prev); next.delete(key); return next; });
            setExcludedSubpaths((prev) => { const next = new Map(prev); next.delete(key); return next; });
        } else {
            setExcludedSubpaths((prev) => {
                const next = new Map(prev);
                const excludes = new Set(next.get(root) ?? []);
                for (const e of Array.from(excludes)) {
                    if (isDescendant(e, key)) excludes.delete(e);
                }
                excludes.add(key);
                next.set(root, excludes);
                return next;
            });
        }
    }, [getIncludedRootFor, isDescendant]);

    const toggleNode = useCallback((key: string) => {
        const state = getNodeState(key);
        if (state === "checked") setUnchecked(key); else setChecked(key);
    }, [getNodeState, setUnchecked, setChecked]);

    const handleExpandToggle = useCallback((key: string) => {
        setExpandedKeys((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key); else next.add(key);
            return next;
        });
        if (!childrenByKey.has(key)) fetchChildren(key);
    }, [childrenByKey, fetchChildren]);

    const reconstructPath = useCallback((key: string): string => {
        const segments: string[] = [];
        let cur: string | undefined = key;
        while (cur) {
            const info: TreeNodeInfo | undefined = nodesByKey.get(cur);
            if (!info) break;
            segments.unshift(info.name);
            cur = info.parentKey || undefined;
        }
        return segments.join("/");
    }, [nodesByKey]);

    useImperativeHandle(ref, () => ({
        getSelection: () => {
            return Array.from(includedRoots).map((rootKey) => {
                const rootPath = reconstructPath(rootKey);
                const excludes = excludedSubpaths.get(rootKey) ?? new Set<string>();
                const excludePatterns = Array.from(excludes).map((excludedKey) => {
                    const excludedPath = reconstructPath(excludedKey);
                    const relative = excludedPath.startsWith(`${rootPath}/`)
                        ? excludedPath.slice(rootPath.length + 1)
                        : excludedPath;
                    return `${relative}/**`;
                });
                return { path: rootPath, excludePatterns };
            });
        },
    }), [includedRoots, excludedSubpaths, reconstructPath]);

    const renderNode = (key: string, depth: number) => {
        const info = nodesByKey.get(key);
        if (!info) return null;
        const state = getNodeState(key);
        const expanded = expandedKeys.has(key);
        const kids = childrenByKey.get(key);

        return (
            <div key={key}>
                <div className="flex items-center gap-1.5 py-1" style={{ paddingLeft: depth * 20 }}>
                    <button
                        type="button"
                        className="p-0.5 rounded hover:bg-muted shrink-0"
                        onClick={() => handleExpandToggle(key)}
                    >
                        {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    </button>
                    <Checkbox
                        checked={state === "indeterminate" ? "indeterminate" : state === "checked"}
                        onCheckedChange={() => toggleNode(key)}
                    />
                    <Folder className="h-4 w-4 text-amber-500 shrink-0" />
                    <span className="text-sm truncate">{info.name}</span>
                </div>
                {expanded && (
                    kids === "loading" ? (
                        <div style={{ paddingLeft: (depth + 1) * 20 }} className="py-1">
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                        </div>
                    ) : kids && kids.length > 0 ? (
                        kids.map((childKey) => renderNode(childKey, depth + 1))
                    ) : (
                        <div style={{ paddingLeft: (depth + 1) * 20 }} className="py-1 text-xs text-muted-foreground">
                            No subfolders
                        </div>
                    )
                )}
            </div>
        );
    };

    const rootKeys = childrenByKey.get("");

    if (rootKeys === "loading" || rootKeys === undefined) {
        return (
            <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (rootKeys.length === 0) {
        return (
            <div className="text-center text-sm text-muted-foreground py-8">
                No folders found at this adapter&apos;s configured root.
            </div>
        );
    }

    return <div>{rootKeys.map((key) => renderNode(key, 0))}</div>;
});
