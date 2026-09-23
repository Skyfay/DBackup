"use client"

import { useState } from "react"
import type { EncryptionProfileSummary } from "@/services/backup/encryption-service"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { updateEncryptionProfile } from "@/app/actions/backup/encryption"

interface EncryptionProfileEditDialogProps {
    /** The profile to edit. The dialog is open while this is set. */
    profile: EncryptionProfileSummary | null
    onClose: () => void
    onSaved: () => void
}

export function EncryptionProfileEditDialog({ profile, onClose, onSaved }: EncryptionProfileEditDialogProps) {
    const [name, setName] = useState("")
    const [description, setDescription] = useState("")
    const [isSaving, setIsSaving] = useState(false)

    // `original` is kept after closing so the fields and the hint do not blank out while the
    // dialog animates away. `filledFor` is cleared on close, so reopening the same profile
    // starts from its stored values again instead of the last unsaved edit.
    const [original, setOriginal] = useState<EncryptionProfileSummary | null>(null)
    const [filledFor, setFilledFor] = useState<string | null>(null)

    if (profile && profile.id !== filledFor) {
        setFilledFor(profile.id)
        setOriginal(profile)
        setName(profile.name)
        setDescription(profile.description ?? "")
    }

    const trimmedName = name.trim()
    const trimmedDescription = description.trim()
    const nameChanged = !!original && trimmedName.length > 0 && trimmedName !== original.name
    const hasChanges = !!original && (trimmedName !== original.name || trimmedDescription !== (original.description ?? ""))

    const close = () => {
        setFilledFor(null)
        onClose()
    }

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!original || !trimmedName || !hasChanges) return

        setIsSaving(true)
        const res = await updateEncryptionProfile(original.id, {
            name: trimmedName,
            description: trimmedDescription || null,
        })
        setIsSaving(false)

        if (res.success) {
            toast.success("Encryption profile updated")
            close()
            onSaved()
        } else {
            toast.error(res.error || "Failed to update profile")
        }
    }

    return (
        <Dialog open={!!profile} onOpenChange={(open) => !open && close()}>
            <DialogContent tone="edit" className="sm:max-w-md">
                <form onSubmit={handleSave}>
                    <DialogHeader>
                        <DialogTitle>Edit Encryption Profile</DialogTitle>
                        <DialogDescription>
                            Change the name and description. The key stays the same.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                            <Label htmlFor="edit-name">Profile Name</Label>
                            <Input
                                id="edit-name"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                maxLength={100}
                            />
                            {nameChanged && (
                                <p className="text-xs text-muted-foreground">
                                    Backups and Recovery Kits find this key by its ID, so they keep working. Importing a config backup matches encryption profiles by name, so a profile with this name in an imported config backup is linked to this key.
                                </p>
                            )}
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="edit-desc">Description (Optional)</Label>
                            <Input
                                id="edit-desc"
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                maxLength={500}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={close}>Cancel</Button>
                        <Button type="submit" disabled={isSaving || !trimmedName || !hasChanges}>
                            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Save
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}
