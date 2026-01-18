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

    const downloadRecoveryKit = (profileName: string, key: string) => {
        const readmeContent = `# Recovery Kit for Profile: ${profileName}
generated at ${new Date().toISOString()}

## ⚠️ WARNING
Store this file securely! This key allows decrypting all backups created with this profile.

## Master Key (Hex)
${key}

## How to Decrypt Manually
You can decrypt your .enc backups using the provided 'decrypt_backup.js' script (requires Node.js).

Usage:
   node decrypt_backup.js <your-backup-file.enc> ${key}

## Requirements
- Node.js installed
- The .meta.json file must be present next to the .enc file
`;

        const scriptContent = `const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

// Usage: node decrypt_backup.js <input_file.enc> <hex_key>
// Or:    node decrypt_backup.js <input_file.enc> <hex_key> <output_file>

const args = process.argv.slice(2);

if (args.length < 2) {
    console.error('Usage: node decrypt_backup.js <input_file.enc> <hex_key> [output_file]');
    process.exit(1);
}

const inputFile = args[0];
const hexKey = args[1];

if (!fs.existsSync(inputFile)) {
    console.error(\`Error: Input file '\${inputFile}' not found.\`);
    process.exit(1);
}

const metaFile = inputFile + '.meta.json';
if (!fs.existsSync(metaFile)) {
    console.error(\`Error: Metadata file '\${metaFile}' not found.\`);
    console.error('The decryption requires the IV and AuthTag stored in the .meta.json sidecar file.');
    process.exit(1);
}

let outputFile = args[2];
if (!outputFile) {
    if (inputFile.endsWith('.enc')) {
        outputFile = inputFile.substring(0, inputFile.length - 4);
    } else {
        outputFile = inputFile + '.dec';
    }
}

try {
    const metaContent = fs.readFileSync(metaFile, 'utf8');
    const meta = JSON.parse(metaContent);

    if (!meta.encryption || !meta.encryption.iv || !meta.encryption.authTag) {
        console.error('Error: valid encryption metadata (iv, authTag) not found in .meta.json');
        process.exit(1);
    }

    console.log('Starting decryption...');
    const masterKey = Buffer.from(hexKey, 'hex');
    const iv = Buffer.from(meta.encryption.iv, 'hex');
    const authTag = Buffer.from(meta.encryption.authTag, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, iv);
    decipher.setAuthTag(authTag);

    const input = fs.createReadStream(inputFile);
    const output = fs.createWriteStream(outputFile);

    input.pipe(decipher).pipe(output);

    output.on('finish', () => {
        console.log('Decryption successful! ✅');
    });

    decipher.on('error', (err) => {
        console.error('Decryption failed! ❌');
        console.error(err.message);
        fs.unlink(outputFile, () => {});
        process.exit(1);
    });

} catch (err) {
    console.error('Unexpected error:', err.message);
    process.exit(1);
}
`;

        // Download README
        const blob = new Blob([readmeContent], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `RECOVERY_KIT_${profileName.replace(/\s+/g, '_')}.md`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        // Download Script
        const scriptBlob = new Blob([scriptContent], { type: 'text/javascript' });
        const scriptUrl = URL.createObjectURL(scriptBlob);
        const sa = document.createElement('a');
        sa.href = scriptUrl;
        sa.download = 'decrypt_backup.js';
        document.body.appendChild(sa);
        sa.click();
        document.body.removeChild(sa);
        URL.revokeObjectURL(scriptUrl);
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
                                    <TableHead>Created</TableHead>
                                    <TableHead className="text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {profiles.map((profile) => (
                                    <TableRow key={profile.id}>
                                        <TableCell>
                                            <div className="font-medium flex items-center gap-2">
                                                <Key className="h-4 w-4 text-amber-500" />
                                                {profile.name}
                                            </div>
                                            {profile.description && (
                                                <div className="text-xs text-muted-foreground">{profile.description}</div>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            <DateDisplay date={profile.createdAt} />
                                        </TableCell>
                                        <TableCell className="text-right">
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
                            <Card className="bg-muted/50 border-amber-200 dark:border-amber-900/30">
                                <CardContent className="p-4 flex flex-col gap-2">
                                    <div className="flex items-center gap-2 font-medium text-amber-700 dark:text-amber-500">
                                        <Download className="h-4 w-4" />
                                        Emergency Recovery Kit
                                    </div>
                                    <p className="text-xs text-muted-foreground mb-2">
                                        Download a secure package containing this key and a standalone decryption script.
                                        Keep this safe (e.g., on a USB drive).
                                    </p>
                                    <Button
                                        className="w-full"
                                        variant="outline"
                                        onClick={() =>
                                            profiles.find(p => p.id === revealedKey?.id) &&
                                            revealedKey &&
                                            downloadRecoveryKit(profiles.find(p => p.id === revealedKey?.id)!.name, revealedKey.key)
                                        }
                                    >
                                        Download Kit (.zip)
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
