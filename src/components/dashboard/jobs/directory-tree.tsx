"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ChevronRight, ChevronDown, Folder, Loader2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
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

export interface DirectoryTreeRow {
    path: string;
    excludePatterns: string[];
    excludePatternPresetId?: string | null;
}

interface DirectoryTreeProps {
    configId: string;
    /** Current directory-source rows for this one adapter - the tree's checked state is always derived from this, never stored independently. */
    rows: DirectoryTreeRow[];
    /** Called with the full replacement row list for this adapter on every toggle - no separate confirm step. */
    onRowsChange: (rows: DirectoryTreeRow[]) => void;
    /** Renders the per-root panel (exclude pattern editing) below a checked/indeterminate root-level row. */
    renderRootPanel?: (row: DirectoryTreeRow, onChange: (patch: Partial<DirectoryTreeRow>) => void) => ReactNode;
}

function isAtOrUnder(candidate: string, base: string): boolean {
    if (base === "") return true;
    return candidate === base || candidate.startsWith(`${base}/`);
}

/**
 * Synology-style checkbox folder tree, lazily loaded one level at a time via
 * GET /api/adapters/[id]/browse. Node identity uses whatever opaque `path` the browse
 * API returns for that adapter (a real path string for most adapters, a folder ID for
 * Google Drive) - hierarchy and the human-readable path are derived from the parent/child
 * relationships recorded as each level is fetched (via `reconstructPath`), not from string
 * parsing of that identifier, so the same logic works uniformly for both cases.
 *
 * Controlled component: `rows` is the single source of truth. Checked/indeterminate state is
 * computed fresh each render from `rows`, and every toggle immediately calls `onRowsChange`
 * with a new row list - there is no separate "confirm" step and no internal selection state,
 * so this same mechanism handles both hydrating an existing job's selection and every
 * subsequent live edit.
 */
export function DirectoryTree({ configId, rows, onRowsChange, renderRootPanel }: DirectoryTreeProps) {
    const [nodesByKey, setNodesByKey] = useState<Map<string, TreeNodeInfo>>(new Map());
    const [childrenByKey, setChildrenByKey] = useState<Map<string, string[] | "loading">>(new Map());
    const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
    const [expandedPanels, setExpandedPanels] = useState<Set<string>>(new Set());

    const fetchChildren = useCallback(async (parentKey: string): Promise<BrowseEntry[]> => {
        setChildrenByKey((prev) => new Map(prev).set(parentKey, "loading"));
        try {
            const res = await fetch(`/api/adapters/${encodeURIComponent(configId)}/browse?path=${encodeURIComponent(parentKey)}`);
            const json = await res.json();
            if (!json.success) {
                toast.error(json.error || "Failed to load folders");
                setChildrenByKey((prev) => new Map(prev).set(parentKey, []));
                return [];
            }
            if (json.supported === false) {
                toast.error("This adapter does not support folder browsing");
                setChildrenByKey((prev) => new Map(prev).set(parentKey, []));
                return [];
            }
            const entries: BrowseEntry[] = json.data?.entries ?? [];
            setNodesByKey((prev) => {
                const next = new Map(prev);
                for (const e of entries) next.set(e.path, { name: e.name, parentKey });
                return next;
            });
            setChildrenByKey((prev) => new Map(prev).set(parentKey, entries.map((e) => e.path)));
            return entries;
        } catch {
            toast.error("Network error while browsing folders");
            setChildrenByKey((prev) => new Map(prev).set(parentKey, []));
            return [];
        }
    }, [configId]);

    // On mount: load the root level, then auto-expand down to every existing row's path (and to
    // each of its structural exclude entries) so an existing selection renders checked immediately.
    useEffect(() => {
        let cancelled = false;
        const levelCache = new Map<string, Promise<BrowseEntry[]>>();
        const getLevel = (parentKey: string) => {
            if (!levelCache.has(parentKey)) levelCache.set(parentKey, fetchChildren(parentKey));
            return levelCache.get(parentKey)!;
        };

        async function hydratePath(segments: string[], keysToExpand: Set<string>) {
            let parentKey = "";
            for (const seg of segments) {
                const entries = await getLevel(parentKey);
                if (cancelled) return;
                const match = entries.find((e) => e.name === seg);
                if (!match) return;
                keysToExpand.add(parentKey);
                parentKey = match.path;
            }
        }

        async function run() {
            await getLevel("");
            if (cancelled) return;
            const keysToExpand = new Set<string>();
            for (const row of rows) {
                const rootSegments = row.path.split("/").filter(Boolean);
                await hydratePath(rootSegments, keysToExpand);
                for (const pattern of row.excludePatterns) {
                    if (!pattern.endsWith("/**")) continue;
                    const relSegments = pattern.slice(0, -3).split("/").filter(Boolean);
                    await hydratePath([...rootSegments, ...relSegments], keysToExpand);
                }
            }
            if (!cancelled && keysToExpand.size > 0) {
                setExpandedKeys((prev) => new Set([...prev, ...keysToExpand]));
            }
        }
        run();
        return () => { cancelled = true; };
        // Intentionally only re-runs when the adapter changes - re-hydrating on every row edit
        // would re-fetch and fight with the user's own expand/collapse state.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [configId]);

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

    const findOwningRow = useCallback((path: string): DirectoryTreeRow | undefined => {
        return rows.find((r) => isAtOrUnder(path, r.path));
    }, [rows]);

    const getNodeState = useCallback((path: string): NodeState => {
        const owningRow = findOwningRow(path);
        if (!owningRow) return "unchecked";
        const relative = path === owningRow.path ? "" : path.slice(owningRow.path.length + 1);
        const structuralExcludes = owningRow.excludePatterns.filter((p) => p.endsWith("/**")).map((p) => p.slice(0, -3));
        if (relative && structuralExcludes.some((ex) => isAtOrUnder(relative, ex))) return "unchecked";
        const prefix = relative ? `${relative}/` : "";
        const hasExcludedDescendant = structuralExcludes.some((ex) => ex !== relative && ex.startsWith(prefix));
        return hasExcludedDescendant ? "indeterminate" : "checked";
    }, [findOwningRow]);

    const toggleNode = useCallback((key: string) => {
        const path = reconstructPath(key);
        if (!path) return;
        const state = getNodeState(path);

        if (state === "checked") {
            const owningRow = findOwningRow(path);
            if (!owningRow) return;
            if (path === owningRow.path) {
                onRowsChange(rows.filter((r) => r !== owningRow));
            } else {
                const relative = path.slice(owningRow.path.length + 1);
                const newExcludes = owningRow.excludePatterns
                    .filter((p) => !(p.endsWith("/**") && isAtOrUnder(p.slice(0, -3), relative)))
                    .concat(`${relative}/**`);
                onRowsChange(rows.map((r) => (r === owningRow ? { ...r, excludePatterns: newExcludes } : r)));
            }
        } else {
            const owningRow = findOwningRow(path);
            if (!owningRow) {
                const filtered = rows.filter((r) => !isAtOrUnder(r.path, path));
                onRowsChange([...filtered, { path, excludePatterns: [], excludePatternPresetId: null }]);
            } else {
                const relative = path === owningRow.path ? "" : path.slice(owningRow.path.length + 1);
                const newExcludes = owningRow.excludePatterns.filter((p) => {
                    if (!p.endsWith("/**")) return true;
                    return !isAtOrUnder(p.slice(0, -3), relative);
                });
                onRowsChange(rows.map((r) => (r === owningRow ? { ...r, excludePatterns: newExcludes } : r)));
            }
        }
    }, [reconstructPath, getNodeState, findOwningRow, rows, onRowsChange]);

    const handleExpandToggle = useCallback((key: string) => {
        setExpandedKeys((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key); else next.add(key);
            return next;
        });
        if (!childrenByKey.has(key)) fetchChildren(key);
    }, [childrenByKey, fetchChildren]);

    const togglePanel = useCallback((path: string) => {
        setExpandedPanels((prev) => {
            const next = new Set(prev);
            if (next.has(path)) next.delete(path); else next.add(path);
            return next;
        });
    }, []);

    const renderNode = (key: string, depth: number) => {
        const info = nodesByKey.get(key);
        if (!info) return null;
        const path = reconstructPath(key);
        const state = getNodeState(path);
        const expanded = expandedKeys.has(key);
        const kids = childrenByKey.get(key);
        const owningRow = state !== "unchecked" ? findOwningRow(path) : undefined;
        const isRoot = owningRow?.path === path;
        const panelOpen = isRoot && expandedPanels.has(path);

        return (
            <div key={key}>
                <div
                    className={cn(
                        "flex items-center gap-2 py-2 px-2 rounded-md",
                        state !== "unchecked" && "bg-accent/40"
                    )}
                    style={{ paddingLeft: depth * 24 + 8 }}
                >
                    <button
                        type="button"
                        className="p-0.5 rounded hover:bg-muted shrink-0"
                        onClick={() => handleExpandToggle(key)}
                    >
                        {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>
                    <Checkbox
                        className="size-4.5"
                        checked={state === "indeterminate" ? "indeterminate" : state === "checked"}
                        onCheckedChange={() => toggleNode(key)}
                    />
                    <Folder className="h-4.5 w-4.5 text-amber-500 shrink-0" />
                    <span className="text-sm truncate flex-1">{info.name}</span>
                    {isRoot && renderRootPanel && (
                        <button
                            type="button"
                            className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted shrink-0"
                            onClick={() => togglePanel(path)}
                        >
                            Excludes{owningRow!.excludePatterns.length > 0 ? ` (${owningRow!.excludePatterns.length})` : ""}
                        </button>
                    )}
                </div>
                {panelOpen && owningRow && renderRootPanel && (
                    <div style={{ paddingLeft: depth * 24 + 40 }} className="pb-2 pr-3">
                        {renderRootPanel(owningRow, (patch) => {
                            onRowsChange(rows.map((r) => (r === owningRow ? { ...r, ...patch } : r)));
                        })}
                    </div>
                )}
                {expanded && (
                    kids === "loading" ? (
                        <div style={{ paddingLeft: (depth + 1) * 24 + 8 }} className="py-1.5">
                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        </div>
                    ) : kids && kids.length > 0 ? (
                        kids.map((childKey) => renderNode(childKey, depth + 1))
                    ) : (
                        <div style={{ paddingLeft: (depth + 1) * 24 + 8 }} className="py-1.5 text-xs text-muted-foreground">
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
}
