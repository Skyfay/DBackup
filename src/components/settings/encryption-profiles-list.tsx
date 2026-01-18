"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { toast } from "sonner"
import { Loader2, Lock, Plus, Trash2, AlertTriangle, ShieldCheck, Key, Download, Copy, Eye, EyeOff } from "lucide-react"
import { EncryptionProfile } from "@prisma/client"
import { createEncryptionProfile, deleteEncryptionProfile, getEncryptionProfiles, revealMasterKey } from "@/app/actions/encryption"
import { DateDisplay } from "@/components/utils/date-display"
import { DataTable } from "@/components/ui/data-table"
import { ColumnDef } from "@tanstack/react-table"

export function EncryptionProfilesList() {
    const [profiles, setProfiles] = useState<EncryptionProfile[]>([])
    const [loading, setLoading] = useState(true)

    // Create Dialog State
    const [isCreateOpen, setIsCreateOpen] = useState(false)
    const [newName, setNewName] = useState("")
    const [newDesc, setNewDesc] = useState("")
    const [isCreating, setIsCreating] = useState(false)

    // Delete Dialog State
    const [profileToDelete, setProfileToDelete] = useState<EncryptionProfile | null>(null)
    const [isDeleting, setIsDeleting] = useState(false)

    // Reveal Key State
    const [revealedKey, setRevealedKey] = useState<{ id: string, key: string } | null>(null)
    const [isRevealing, setIsRevealing] = useState(false)

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
        fetchProfiles()
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

    const handleRevealKey = async (id: string, name: string) => {
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

    const downloadRecoveryKit = (profileId: string) => {
        window.location.href = `/api/vault/${profileId}/recovery-kit`;
    }

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
                    <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                        <DialogTrigger asChild>
                            <Button size="sm">
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
                    />
                )}
            </CardContent>

            {/* Delete Confirmation Dialog */}
            <Dialog open={!!profileToDelete} onOpenChange={(open) => !open && setProfileToDelete(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="text-destructive flex items-center gap-2">
                            <AlertTriangle className="h-5 w-5" />
                            Danger: Delete Encryption Key
                        </DialogTitle>
                        <DialogDescription className="space-y-3 pt-2">
                            <p>
                                Are you sure you want to delete the profile <strong>{profileToDelete?.name}</strong>?
                            </p>
                            <p className="font-bold text-destructive">
                                WARNING: Any existing backups encrypted with this key will become PERMANENTLY UNREADABLE. There is no way to recover them.
                            </p>
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
                                            downloadRecoveryKit(revealedKey.id)
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
        </Card>
    )
}
