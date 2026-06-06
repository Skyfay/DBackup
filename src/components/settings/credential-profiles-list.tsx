"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { ColumnDef } from "@tanstack/react-table";
import { Loader2, KeyRound, Plus, Trash2, Pencil, Eye, AlertTriangle, Copy } from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { DateDisplay } from "@/components/utils/date-display";
import {
    CredentialProfileDialog,
    type CredentialProfileSummary,
} from "./credential-profile-dialog";
import type { CredentialType } from "@/lib/core/credentials";

const TYPE_LABELS: Record<CredentialType, string> = {
    USERNAME_PASSWORD: "User/Pass",
    SSH_KEY: "SSH Key",
    ACCESS_KEY: "Access Key",
    TOKEN: "Token",
    SMTP: "SMTP",
    WEBHOOK: "Webhook",
    OAUTH: "OAuth",
};

const TYPE_FILTER_OPTIONS = (Object.entries(TYPE_LABELS) as [CredentialType, string][]).map(
    ([value, label]) => ({ label, value }),
);

const FILTERABLE_COLUMNS = [
    {
        id: "type",
        title: "Type",
        options: TYPE_FILTER_OPTIONS,
    },
];

interface UsageEntry {
    adapterId: string;
    name: string;
    type: string;
    slot: "primary" | "ssh";
}

export function CredentialProfilesList({ canReveal }: { canReveal: boolean }) {
    const [profiles, setProfiles] = useState<CredentialProfileSummary[]>([]);
    const [referenceCounts, setReferenceCounts] = useState<Record<string, number>>({});
    const [loading, setLoading] = useState(true);

    const [dialogOpen, setDialogOpen] = useState(false);
    const [editProfile, setEditProfile] = useState<CredentialProfileSummary | null>(null);

    const [profileToDelete, setProfileToDelete] = useState<CredentialProfileSummary | null>(null);
    const [usage, setUsage] = useState<UsageEntry[]>([]);
    const [isDeleting, setIsDeleting] = useState(false);

    const [revealed, setRevealed] = useState<{
        id: string;
        name: string;
        type: CredentialType;
        payload: Record<string, string>;
    } | null>(null);
    const [isRevealing, setIsRevealing] = useState<string | null>(null);

    const fetchProfiles = async () => {
        setLoading(true);
        try {
            const res = await fetch("/api/credentials?includeCounts=true");
            const result = await res.json();
            if (!res.ok || !result.success) {
                toast.error(result.error || "Failed to load credential profiles");
                setProfiles([]);
                return;
            }
            const list = result.data as Array<CredentialProfileSummary & { usageCount: number }>;
            setProfiles(list);
            const counts: Record<string, number> = {};
            for (const p of list) counts[p.id] = p.usageCount ?? 0;
            setReferenceCounts(counts);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchProfiles();
    }, []);

    const openCreate = () => {
        setEditProfile(null);
        setDialogOpen(true);
    };

    const openEdit = (profile: CredentialProfileSummary) => {
        setEditProfile(profile);
        setDialogOpen(true);
    };

    const onSaved = () => {
        fetchProfiles();
    };

    const requestDelete = async (profile: CredentialProfileSummary) => {
        setProfileToDelete(profile);
        // Fetch usage so we can show the warning
        try {
            const r = await fetch(`/api/credentials/${profile.id}/usage`);
            const j = await r.json();
            if (r.ok && j.success) setUsage(j.data.references ?? []);
            else setUsage([]);
        } catch {
            setUsage([]);
        }
    };

    const handleDelete = async () => {
        if (!profileToDelete) return;
        setIsDeleting(true);
        try {
            const res = await fetch(`/api/credentials/${profileToDelete.id}`, {
                method: "DELETE",
            });
            const result = await res.json().catch(() => null);
            if (!res.ok) {
                toast.error(result?.error || "Failed to delete profile");
                return;
            }
            toast.success("Credential profile deleted");
            setProfileToDelete(null);
            setUsage([]);
            fetchProfiles();
        } finally {
            setIsDeleting(false);
        }
    };

    const handleReveal = async (profile: CredentialProfileSummary) => {
        setIsRevealing(profile.id);
        try {
            const res = await fetch(`/api/credentials/${profile.id}/reveal`);
            const result = await res.json();
            if (!res.ok || !result.success) {
                toast.error(result.error || "Failed to reveal credential");
                return;
            }
            setRevealed({
                id: profile.id,
                name: profile.name,
                type: profile.type,
                payload: result.data.payload,
            });
        } finally {
            setIsRevealing(null);
        }
    };

    const copy = (text: string) => {
        if (!navigator.clipboard) {
            toast.error("Clipboard not available");
            return;
        }
        navigator.clipboard
            .writeText(text)
            .then(() => toast.success("Copied to clipboard"))
            .catch(() => toast.error("Failed to copy"));
    };

    const columns: ColumnDef<CredentialProfileSummary>[] = [
        {
            accessorKey: "name",
            header: "Name",
            cell: ({ row }) => {
                const p = row.original;
                return (
                    <div>
                        <div className="font-medium">{p.name}</div>
                        {p.description && (
                            <div className="text-xs text-muted-foreground">{p.description}</div>
                        )}
                    </div>
                );
            },
        },
        {
            accessorKey: "type",
            header: "Type",
            filterFn: (row, id, value) => value.includes(row.getValue(id)),
            cell: ({ row }) => (
                <Badge variant="outline">{TYPE_LABELS[row.original.type]}</Badge>
            ),
        },
        {
            id: "usage",
            header: "References",
            cell: ({ row }) => {
                const count = referenceCounts[row.original.id] ?? 0;
                return (
                    <span className={count > 0 ? "" : "text-muted-foreground"}>
                        {count} {count === 1 ? "adapter" : "adapters"}
                    </span>
                );
            },
        },
        {
            accessorKey: "createdAt",
            header: "Created",
            cell: ({ row }) => <DateDisplay date={row.getValue("createdAt")} />,
        },
        {
            id: "actions",
            header: () => <div className="text-right">Actions</div>,
            cell: ({ row }) => {
                const p = row.original;
                return (
                    <div className="flex justify-end gap-1">
                        {canReveal && (
                            <Button
                                variant="ghost"
                                size="icon"
                                title="Reveal secret"
                                onClick={() => handleReveal(p)}
                                disabled={isRevealing === p.id}
                            >
                                {isRevealing === p.id ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                    <Eye className="h-4 w-4" />
                                )}
                            </Button>
                        )}
                        <Button
                            variant="ghost"
                            size="icon"
                            title="Edit profile"
                            onClick={() => openEdit(p)}
                        >
                            <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            title="Delete profile"
                            onClick={() => requestDelete(p)}
                        >
                            <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                    </div>
                );
            },
        },
    ];

    return (
        <Card>
            <CardHeader>
                <div className="flex items-center justify-between">
                    <div>
                        <CardTitle className="flex items-center gap-2">
                            <KeyRound className="h-5 w-5" />
                            Credential Profiles
                        </CardTitle>
                        <CardDescription>
                            Reusable credentials referenced by adapters. Secrets are encrypted at rest and never leave the server unless you explicitly reveal them.
                        </CardDescription>
                    </div>
                    <Button size="sm" onClick={openCreate}>
                        <Plus className="mr-2 h-4 w-4" />
                        New Profile
                    </Button>
                </div>
            </CardHeader>
            <CardContent>
                {loading ? (
                    <div className="flex justify-center p-8">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                ) : (
                    <DataTable
                        columns={columns}
                        data={profiles}
                        searchKey="name"
                        filterableColumns={FILTERABLE_COLUMNS}
                        onRefresh={fetchProfiles}
                    />
                )}
            </CardContent>

            <CredentialProfileDialog
                open={dialogOpen}
                onOpenChange={setDialogOpen}
                editProfile={editProfile}
                onSaved={onSaved}
            />

            {/* Delete dialog with usage warning */}
            <Dialog
                open={!!profileToDelete}
                onOpenChange={(open) => {
                    if (!open) {
                        setProfileToDelete(null);
                        setUsage([]);
                    }
                }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-destructive">
                            <AlertTriangle className="h-5 w-5" />
                            Delete credential profile
                        </DialogTitle>
                        <DialogDescription>
                            You are about to delete <strong>{profileToDelete?.name}</strong>.
                        </DialogDescription>
                    </DialogHeader>

                    {usage.length > 0 ? (
                        <Alert variant="destructive">
                            <AlertTriangle className="h-4 w-4" />
                            <AlertTitle>Profile is in use</AlertTitle>
                            <AlertDescription>
                                <p className="mb-2">
                                    {usage.length} adapter(s) reference this profile. Detach it first:
                                </p>
                                <ul className="list-disc pl-5 space-y-0.5">
                                    {usage.map((u) => (
                                        <li key={u.adapterId + u.slot}>
                                            <span className="font-medium">{u.name}</span>{" "}
                                            <span className="text-xs">
                                                ({u.type}, {u.slot})
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            </AlertDescription>
                        </Alert>
                    ) : (
                        <p className="text-sm text-muted-foreground">
                            This profile is not referenced by any adapter and can be deleted safely.
                        </p>
                    )}

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setProfileToDelete(null)}>
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={handleDelete}
                            disabled={isDeleting || usage.length > 0}
                        >
                            {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Delete
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Reveal dialog */}
            <Dialog open={!!revealed} onOpenChange={(o) => !o && setRevealed(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Revealed credential: {revealed?.name}</DialogTitle>
                        <DialogDescription>
                            Treat these values as sensitive. This action has been audited.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-3">
                        {revealed &&
                            Object.entries(revealed.payload).map(([k, v]) => (
                                <div key={k} className="space-y-1">
                                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                                        {k}
                                    </div>
                                    <div className="flex gap-2">
                                        <pre className="flex-1 rounded border bg-muted p-2 font-mono text-xs whitespace-pre-wrap break-all">
                                            {v}
                                        </pre>
                                        <Button
                                            variant="outline"
                                            size="icon"
                                            onClick={() => copy(v)}
                                            title="Copy"
                                        >
                                            <Copy className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>
                            ))}
                    </div>

                    <DialogFooter>
                        <Button onClick={() => setRevealed(null)}>Close</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    );
}
