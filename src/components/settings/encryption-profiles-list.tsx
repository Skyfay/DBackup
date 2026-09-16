"use client"

import { useState, useEffect, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { toast } from "sonner"
import { Loader2, Lock, Plus, Trash2, AlertTriangle, ShieldCheck, Download, Copy, Eye, Import, Pencil } from "lucide-react"
import { EncryptionProfile } from "@prisma/client"
import { createEncryptionProfile, importEncryptionProfile, deleteEncryptionProfile, getEncryptionProfiles, revealMasterKey, bulkDeleteEncryptionProfiles } from "@/app/actions/backup/encryption"
import { DateDisplay } from "@/components/utils/date-display"
import { DataTable, type BulkAction } from "@/components/ui/data-table"
import { unwrapBulkAction } from "@/lib/bulk-request"
import { Checkbox } from "@/components/ui/checkbox"
import { ScrollArea } from "@/components/ui/scroll-area"
import { ColumnDef } from "@tanstack/react-table"
import { EncryptionProfileEditDialog } from "@/components/settings/encryption-profile-edit-dialog"

export function EncryptionProfilesList() {
    const [profiles, setProfiles] = useState<EncryptionProfile[]>([])
    const [loading, setLoading] = useState(true)

    // Create Dialog State
    const [isCreateOpen, setIsCreateOpen] = useState(false)
    const [newName, setNewName] = useState("")
    const [newDesc, setNewDesc] = useState("")
    const [isCreating, setIsCreating] = useState(false)

    // Import Dialog State
    const [isImportOpen, setIsImportOpen] = useState(false)
    const [importKey, setImportKey] = useState("")

    // Edit Dialog State
    const [profileToEdit, setProfileToEdit] = useState<EncryptionProfile | null>(null)

    // Delete Dialog State
    const [profileToDelete, setProfileToDelete] = useState<EncryptionProfile | null>(null)
    const [isDeleting, setIsDeleting] = useState(false)

    // Reveal Key State
    const [revealedKey, setRevealedKey] = useState<{ id: string, key: string } | null>(null)
    const [isRevealing, setIsRevealing] = useState(false)

    // Recovery Kit Export State
    const [isKitOpen, setIsKitOpen] = useState(false)
    const [selectedForKit, setSelectedForKit] = useState<Set<string>>(new Set())

    const fetchProfiles = async () => {
        setLoading(true)
        const res = await getEncryptionProfiles()
        if (res.success && res.data) {
            setProfiles(res.data)
        } else {
            toast.error("Failed to load encryption profiles")
        }
        setLoading(false)
    }

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        fetchProfiles();
    }, [])

    const handleCreate = async () => {
        if (!newName.trim()) return
        setIsCreating(true)
        const res = await createEncryptionProfile(newName, newDesc)
        setIsCreating(false)

        if (res.success) {
            toast.success("Encryption Profile created")
            setIsCreateOpen(false)
            setNewName("")
            setNewDesc("")
            fetchProfiles()
        } else {
            toast.error(res.error || "Failed to create profile")
        }
    }

    const handleImport = async () => {
        if (!newName || !importKey) return;

        // Basic client validation
        if (importKey.length !== 64) {
             toast.error("Invalid key length. Must be exactly 64 characters (Hex).");
             return;
        }

        setIsCreating(true)
        const res = await importEncryptionProfile(newName, importKey, newDesc)
        setIsCreating(false)

        if (res.success) {
            toast.success("Encryption profile imported successfully")
            setIsImportOpen(false)
            setNewName("")
            setNewDesc("")
            setImportKey("")
            fetchProfiles()
        } else {
            toast.error(res.error || "Failed to import profile")
        }
    }

    const handleDelete = async () => {
        if (!profileToDelete) return
        setIsDeleting(true)
        const res = await deleteEncryptionProfile(profileToDelete.id)
        setIsDeleting(false)

        if (res.success) {
            toast.success("Profile deleted")
            setProfileToDelete(null)
            fetchProfiles()
        } else {
            toast.error(res.error || "Failed to delete profile")
        }
    }

    const handleRevealKey = async (id: string, _name: string) => {
        if (revealedKey?.id === id) {
            setRevealedKey(null);
            return;
        }

        setIsRevealing(true);
        const res = await revealMasterKey(id);
        setIsRevealing(false);

        if (res.success && res.data) {
            setRevealedKey({ id, key: res.data });
        } else {
            toast.error(res.error || "Failed to retrieve key");
        }
    }

    const copyToClipboard = (text: string) => {
        if (!navigator.clipboard) {
            toast.error("Clipboard access denied (Context not secure/HTTPS)");
            return;
        }
        navigator.clipboard.writeText(text).then(() => {
            toast.success("Key copied to clipboard");
        }).catch(() => {
            toast.error("Failed to copy key");
        });
    }

    const downloadRecoveryKit = (profileIds: string[]) => {
        if (profileIds.length === 0) return;
        window.location.href = `/api/vault/recovery-kit?ids=${profileIds.map(encodeURIComponent).join(",")}`;
        setIsKitOpen(false);
    }

    /**
     * Opens the export dialog with everything ticked.
     *
     * One kit covering every profile is the useful default: a backup records which profile
     * encrypted it, so the tool picks the right key by itself and nobody has to work out
     * which of several kits belongs to which job. Unticking is there for handing someone a
     * kit that only opens what they should see.
     */
    const openKitDialog = () => {
        setSelectedForKit(new Set(profiles.map((profile) => profile.id)));
        setIsKitOpen(true);
    }

    const allSelectedForKit = profiles.length > 0 && selectedForKit.size === profiles.length;

    const toggleForKit = (profileId: string) => {
        setSelectedForKit((prev) => {
            const next = new Set(prev);
            if (next.has(profileId)) next.delete(profileId);
            else next.add(profileId);
            return next;
        });
    }

    const bulkActions = useMemo<BulkAction<EncryptionProfile>[]>(() => [
        {
            id: "delete",
            labels: { verb: "delete", verbPast: "deleted", noun: "encryption profile" },
            icon: Trash2,
            variant: "destructive",
            itemName: (profile) => profile.name,
            confirm: {
                title: (rows) => `Delete ${rows.length} encryption profile${rows.length === 1 ? "" : "s"}?`,
                // The strongest warning in the app belongs here. Losing a key is not
                // recoverable by any means DBackup has.
                description: () =>
                    "Every backup encrypted with these profiles becomes permanently unreadable. Make sure you hold a Recovery Kit for anything you still need.",
                confirmLabel: "Delete",
            },
            run: (rows) => unwrapBulkAction(bulkDeleteEncryptionProfiles(rows.map((profile) => profile.id))),
        },
    ], []);

    const columns: ColumnDef<EncryptionProfile>[] = [
        {
            accessorKey: "name",
            header: "Profile Name",
            cell: ({ row }) => {
                const profile = row.original;
                return (
                    <div>
                        <div className="font-medium flex items-center gap-2">
                             {profile.name}
                        </div>
                        {profile.description && (
                            <div className="text-xs text-muted-foreground">{profile.description}</div>
                        )}
                    </div>
                );
            }
        },
        {
            accessorKey: "createdAt",
            header: "Created",
            cell: ({ row }) => (
                <DateDisplay date={row.getValue("createdAt")} />
            ),
        },
        {
            id: "actions",
            header: () => <div className="text-right">Actions</div>,
            cell: ({ row }) => {
                const profile = row.original;
                return (
                    <div className="flex justify-end gap-1">
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleRevealKey(profile.id, profile.name)}
                            title="Reveal Master Key & Recovery Options"
                        >
                            {isRevealing && revealedKey?.id !== profile.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <Eye className="h-4 w-4" />
                            )}
                        </Button>

                        <Button variant="ghost" size="icon" onClick={() => setProfileToEdit(profile)} title="Edit profile">
                            <Pencil className="h-4 w-4" />
                        </Button>

                        <Button variant="ghost" size="icon" onClick={() => setProfileToDelete(profile)}>
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
                <div className="flex justify-between items-center">
                    <div>
                        <CardTitle className="flex items-center gap-2">
                            <Lock className="h-5 w-5" />
                            Encryption Vault
                        </CardTitle>
                        <CardDescription>
                            Create encryption keys (profiles) to protect your backups. Keys are managed securely by the system.
                        </CardDescription>
                    </div>
                    <div className="flex gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={openKitDialog}
                            disabled={profiles.length === 0}
                        >
                            <Download className="mr-2 h-4 w-4" />
                            Recovery Kit
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => {
                            setNewName(""); setNewDesc(""); setImportKey("");
                            setIsImportOpen(true);
                        }}>
                            <Import className="mr-2 h-4 w-4" />
                            Import Key
                        </Button>
                        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                            <DialogTrigger asChild>
                                <Button size="sm" onClick={() => { setNewName(""); setNewDesc(""); }}>
                                    <Plus className="mr-2 h-4 w-4" />
                                    Create Key
                                </Button>
                            </DialogTrigger>
                            <DialogContent>
                                <DialogHeader>
                                    <DialogTitle>Create Encryption Profile</DialogTitle>
                                    <DialogDescription>
                                        This will generate a secure 256-bit key stored internally. You can simply select this profile in your Backup Jobs.
                                    </DialogDescription>
                                </DialogHeader>
                                <div className="grid gap-4 py-4">
                                    <div className="grid grid-cols-4 items-center gap-4">
                                        <Label htmlFor="name" className="text-right">Name</Label>
                                        <Input
                                            id="name"
                                            value={newName}
                                            onChange={(e) => setNewName(e.target.value)}
                                            className="col-span-3"
                                            placeholder="e.g., Offsite S3 Key"
                                        />
                                    </div>
                                    <div className="grid grid-cols-4 items-center gap-4">
                                        <Label htmlFor="desc" className="text-right">Description</Label>
                                        <Input
                                            id="desc"
                                            value={newDesc}
                                            onChange={(e) => setNewDesc(e.target.value)}
                                            className="col-span-3"
                                            placeholder="Optional"
                                        />
                                    </div>
                                </div>
                                <DialogFooter>
                                    <Button onClick={handleCreate} disabled={isCreating || !newName}>
                                        {isCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                        Generate Key
                                    </Button>
                                </DialogFooter>
                            </DialogContent>
                        </Dialog>
                    </div>
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
                        onRefresh={fetchProfiles}
                        enableRowSelection
                        getRowId={(profile) => profile.id}
                        bulkActions={bulkActions}
                        onBulkActionComplete={fetchProfiles}
                    />
                )}
            </CardContent>

            {/* Recovery Kit Export Dialog */}
            <Dialog open={isKitOpen} onOpenChange={setIsKitOpen}>
                <DialogContent className="sm:max-w-md max-h-[90vh] p-0">
                    <div className="px-6 pt-6 pb-4 shrink-0">
                        <DialogHeader>
                            <DialogTitle>Download Recovery Kit</DialogTitle>
                            <DialogDescription>
                                A standalone tool that restores your backups without DBackup. One kit
                                can carry several keys and picks the right one per backup.
                            </DialogDescription>
                        </DialogHeader>
                    </div>

                    <div className="flex items-center justify-between px-6 pb-2 shrink-0">
                        <span className="text-xs text-muted-foreground">
                            {selectedForKit.size} of {profiles.length} selected
                        </span>
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => setSelectedForKit(
                                allSelectedForKit ? new Set() : new Set(profiles.map((p) => p.id))
                            )}
                        >
                            {allSelectedForKit ? "Deselect all" : "Select all"}
                        </Button>
                    </div>

                    {/* flex-1 min-h-0 rather than a max-height: the header wraps to a
                        different number of lines depending on the viewport, and any fixed
                        subtraction pushed the footer off the bottom of the dialog. */}
                    {/* Two measured budgets, because the footer stacks its buttons below sm:
                        and the chrome is genuinely taller there. The nested !block undoes
                        Radix's display:table wrapper, which sizes to the widest unbroken
                        text and pushes the right-hand padding out of view. */}
                    <ScrollArea className="*:data-[slot=scroll-area-viewport]:max-h-[calc(90vh-26rem)] sm:*:data-[slot=scroll-area-viewport]:max-h-[calc(90vh-21rem)] [&>[data-slot=scroll-area-viewport]>div]:!block">
                        {/* pr-8 rather than pr-6: the scrollbar is drawn over the last 10px
                            of the gutter, so matching the header's px-6 exactly leaves the
                            cards visibly closer to the right edge than to the left. */}
                        <div className="space-y-2 pl-6 pr-8 pb-4">
                            {profiles.map((profile) => (
                                <label
                                    key={profile.id}
                                    htmlFor={`kit-${profile.id}`}
                                    // A fixed minimum height keeps rows even whether or not a profile
                                    // carries a description.
                                    className="flex min-h-14 items-center gap-3 rounded-md border px-3 py-2 cursor-pointer hover:bg-accent/50"
                                >
                                    <Checkbox
                                        id={`kit-${profile.id}`}
                                        checked={selectedForKit.has(profile.id)}
                                        onCheckedChange={() => toggleForKit(profile.id)}
                                    />
                                    <div className="min-w-0">
                                        <p className="text-sm font-medium leading-tight truncate">{profile.name}</p>
                                        {profile.description && (
                                            <p className="text-xs text-muted-foreground leading-tight truncate mt-0.5">
                                                {profile.description}
                                            </p>
                                        )}
                                    </div>
                                </label>
                            ))}
                        </div>
                    </ScrollArea>

                    <div className="px-6 pt-3 pb-6 space-y-3 shrink-0">
                        <p className="flex items-start gap-2 text-xs text-destructive">
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
                            <span>
                                {selectedForKit.size > 1
                                    ? `Opens every backup made with any of these ${selectedForKit.size} profiles. Store it away from your backups.`
                                    : "Contains the raw key. Store it away from your backups."}
                            </span>
                        </p>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setIsKitOpen(false)}>Cancel</Button>
                            <Button
                                onClick={() => downloadRecoveryKit([...selectedForKit])}
                                disabled={selectedForKit.size === 0}
                            >
                                <Download className="mr-2 h-4 w-4" />
                                Download {selectedForKit.size > 1 ? `${selectedForKit.size} keys` : "kit"}
                            </Button>
                        </DialogFooter>
                    </div>
                </DialogContent>
            </Dialog>

            <EncryptionProfileEditDialog
                profile={profileToEdit}
                onClose={() => setProfileToEdit(null)}
                onSaved={fetchProfiles}
            />

            {/* Delete Confirmation Dialog */}
            <Dialog open={!!profileToDelete} onOpenChange={(open) => !open && setProfileToDelete(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="text-destructive flex items-center gap-2">
                            <AlertTriangle className="h-5 w-5" />
                            Danger: Delete Encryption Key
                        </DialogTitle>
                        <DialogDescription className="space-y-3 pt-2" asChild>
                            <div>
                                <p>
                                    Are you sure you want to delete the profile <strong>{profileToDelete?.name}</strong>?
                                </p>
                                <p className="font-bold text-destructive">
                                    WARNING: Any existing backups encrypted with this key will become PERMANENTLY UNREADABLE. There is no way to recover them.
                                </p>
                            </div>
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setProfileToDelete(null)}>Cancel</Button>
                        <Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
                            {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Delete Permanently
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Reveal Key Dialog */}
            <Dialog open={!!revealedKey} onOpenChange={(open) => !open && setRevealedKey(null)}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <ShieldCheck className="h-5 w-5 text-amber-500" />
                            Master Key Recovery
                        </DialogTitle>
                        <DialogDescription>
                            This <strong>Master Key</strong> is required to decrypt your backups.
                            Store it securely. If you lose this key, your backups are lost forever.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-2">
                        <Alert variant="destructive" className="py-2">
                            <AlertTriangle className="h-4 w-4" />
                            <AlertTitle className="ml-2 text-sm font-semibold">Security Warning</AlertTitle>
                            <AlertDescription className="ml-2 text-xs">
                                Do not share this key. Anyone with this key and your backup files can access your data.
                            </AlertDescription>
                        </Alert>

                        <div className="space-y-2">
                            <Label>Raw Master Key (Hex)</Label>
                            <div className="flex gap-2">
                                <Input
                                    value={revealedKey?.key || ""}
                                    readOnly
                                    className="font-mono text-xs bg-muted"
                                />
                                <Button
                                    variant="outline"
                                    size="icon"
                                    className="shrink-0"
                                    onClick={() => revealedKey && copyToClipboard(revealedKey.key)}
                                    title="Copy to Clipboard"
                                >
                                    <Copy className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>

                        <div className="pt-2">
                            <Card className="bg-muted/50">
                                <CardContent className="p-3 flex items-center justify-between gap-3">
                                    <div className="flex flex-col gap-1">
                                        <div className="flex items-center gap-2 font-medium text-sm">
                                            <Download className="h-4 w-4" />
                                            Recovery Kit
                                        </div>
                                        <p className="text-[10px] text-muted-foreground leading-tight">
                                            Includes key & decryption script.
                                        </p>
                                    </div>
                                    <Button
                                        className="shrink-0 h-8 text-xs"
                                        variant="outline"
                                        onClick={() =>
                                            revealedKey &&
                                            downloadRecoveryKit([revealedKey.id])
                                        }
                                    >
                                        Download .zip
                                    </Button>
                                </CardContent>
                            </Card>
                        </div>
                    </div>

                    <DialogFooter className="sm:justify-start">
                        <Button
                            type="button"
                            variant="secondary"
                            className="w-full"
                            onClick={() => setRevealedKey(null)}
                        >
                            Close
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Import Dialog */}
            <Dialog open={isImportOpen} onOpenChange={setIsImportOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Import Master Key</DialogTitle>
                        <DialogDescription>
                            Import an existing 256-bit key (Hex format) for disaster recovery.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <Alert className="bg-amber-500/10 text-amber-600 border-amber-500/20 px-4 py-3">
                            <AlertTriangle className="h-4 w-4" />
                            <div className="ml-2">
                                <AlertTitle>Disaster Recovery Note</AlertTitle>
                                <AlertDescription className="text-xs mt-1">
                                    <p>
                                        Importing a key creates a <span className="font-bold">new Profile ID</span>. Existing backups are linked to the old ID. The system&apos;s <span className="font-bold">Smart Recovery</span> will automatically detect and use this key during restore if the original profile is missing, so no manual action is required.
                                    </p>
                                </AlertDescription>
                            </div>
                        </Alert>

                        <div className="grid gap-2">
                            <Label htmlFor="import-name">Profile Name</Label>
                            <Input
                                id="import-name"
                                value={newName}
                                onChange={(e) => setNewName(e.target.value)}
                                placeholder="e.g. Restored Offsite Key"
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="import-key">Master Key (Hex)</Label>
                            <Input
                                id="import-key"
                                value={importKey}
                                onChange={(e) => setImportKey(e.target.value)}
                                placeholder="e.g. 8a2f..."
                                className="font-mono text-xs"
                            />
                            <p className="text-[10px] text-muted-foreground text-right">
                                {importKey.length}/64 characters
                            </p>
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="import-desc">Description (Optional)</Label>
                            <Input
                                id="import-desc"
                                value={newDesc}
                                onChange={(e) => setNewDesc(e.target.value)}
                                placeholder="Restored from backup..."
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsImportOpen(false)}>Cancel</Button>
                        <Button onClick={handleImport} disabled={!newName || !importKey || isCreating}>
                            {isCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Import Key
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    )
}
