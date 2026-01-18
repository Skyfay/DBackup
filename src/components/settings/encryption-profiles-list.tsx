"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { toast } from "sonner"
import { Loader2, Lock, Plus, Trash2, AlertTriangle, ShieldCheck } from "lucide-react"
import { EncryptionProfile } from "@prisma/client"
import { createEncryptionProfile, deleteEncryptionProfile, getEncryptionProfiles } from "@/app/actions/encryption"
import { DateDisplay } from "@/components/utils/date-display"

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
                    <div className="flex justify-center p-4"><Loader2 className="animate-spin" /></div>
                ) : profiles.length === 0 ? (
                    <div className="text-center p-8 text-muted-foreground bg-muted/20 rounded-lg border border-dashed">
                        <ShieldCheck className="mx-auto h-10 w-10 mb-2 opacity-50" />
                        <p>No encryption profiles found.</p>
                        <p className="text-sm">Create one to start encrypting your backups.</p>
                    </div>
                ) : (
                    <div className="rounded-md border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Profile Name</TableHead>
                                    <TableHead>Description</TableHead>
                                    <TableHead>Created</TableHead>
                                    <TableHead className="w-[80px]"></TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {profiles.map((profile) => (
                                    <TableRow key={profile.id}>
                                        <TableCell className="font-medium flex items-center gap-2">
                                            <Lock className="h-3 w-3 text-muted-foreground" />
                                            {profile.name}
                                        </TableCell>
                                        <TableCell>{profile.description || "-"}</TableCell>
                                        <TableCell>
                                            <DateDisplay date={profile.createdAt} />
                                        </TableCell>
                                        <TableCell>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="text-destructive hover:text-destructive/90 hover:bg-destructive/10"
                                                onClick={() => setProfileToDelete(profile)}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
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
        </Card>
    )
}
