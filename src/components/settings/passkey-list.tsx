"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { startRegistration } from '@simplewebauthn/browser';
import { generatePasskeyRegistrationOptions, verifyPasskeyRegistration, deletePasskey } from "@/actions/passkeys";
import { toast } from "sonner";
import { Loader2, Trash2, Fingerprint } from "lucide-react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";

interface Authenticator {
    credentialID: string;
    counter: number;
    name?: string;
}

interface PasskeyListProps {
    passkeys: Authenticator[]
}

export function PasskeyList({ passkeys }: PasskeyListProps) {
    const [registering, setRegistering] = useState(false);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [passkeyName, setPasskeyName] = useState("");
    const router = useRouter(); // Need to import useRouter to force refresh if revalidatePath is not enough

    const handleRegister = async () => {
        if (!passkeyName.trim()) {
            toast.error("Please enter a name for your passkey");
            return;
        }

        setRegistering(true);
        try {
            const options = await generatePasskeyRegistrationOptions();
            const attResp = await startRegistration(options);
            await verifyPasskeyRegistration(attResp, passkeyName);
            toast.success("Passkey registered successfully!");
            setIsDialogOpen(false);
            setPasskeyName("");
            router.refresh(); // Refresh client view to fetch new passkey list
        } catch (error) {
            console.error(error);
            if (error instanceof Error) {
                 toast.error(error.message);
            } else {
                 toast.error("Failed to register passkey");
            }
        } finally {
            setRegistering(false);
        }
    }

    const handleDelete = async (id: string) => {
        try {
            await deletePasskey(id);
            toast.success("Passkey deleted");
            router.refresh();
        } catch (error) {
            toast.error("Failed to delete passkey");
        }
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>Passkeys</CardTitle>
                <CardDescription>
                    Manage your passkeys for passwordless login.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex flex-col gap-2">
                    {passkeys.length === 0 && (
                        <p className="text-sm text-muted-foreground">No passkeys registered yet.</p>
                    )}
                    {passkeys.map((pk) => (
                        <div key={pk.credentialID} className="flex items-center justify-between p-3 border rounded-md">
                            <div className="flex items-center gap-3">
                                <Fingerprint className="h-5 w-5 text-muted-foreground" />
                                <div className="flex flex-col">
                                    <span className="text-sm font-medium">{pk.name || "Passkey"}</span>
                                    <span className="text-xs text-muted-foreground font-mono truncate max-w-[200px]">
                                        ID: {pk.credentialID.substring(0, 8)}...
                                    </span>
                                </div>
                            </div>
                            <AlertDialog>
                                <AlertDialogTrigger asChild>
                                    <Button variant="ghost" size="icon">
                                        <Trash2 className="h-4 w-4 text-red-500" />
                                    </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                    <AlertDialogHeader>
                                        <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                                        <AlertDialogDescription>
                                            This action cannot be undone. This will permanently delete your passkey.
                                        </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                                        <AlertDialogAction onClick={() => handleDelete(pk.credentialID)} className="bg-red-500 hover:bg-red-600 focus:ring-red-600">
                                            Delete
                                        </AlertDialogAction>
                                    </AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>
                        </div>
                    ))}
                </div>
                <div className="pt-2">
                    <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                        <DialogTrigger asChild>
                            <Button>Add Passkey</Button>
                        </DialogTrigger>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle>Add New Passkey</DialogTitle>
                                <DialogDescription>
                                    Create a new passkey to log in securely without a password. Give it a memorable name.
                                </DialogDescription>
                            </DialogHeader>
                            <div className="grid gap-4 py-4">
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label htmlFor="name" className="text-right">
                                        Name
                                    </Label>
                                    <Input
                                        id="name"
                                        value={passkeyName}
                                        onChange={(e) => setPasskeyName(e.target.value)}
                                        placeholder="e.g. MacBook Pro TouchID"
                                        className="col-span-3"
                                    />
                                </div>
                            </div>
                            <DialogFooter>
                                <Button onClick={handleRegister} disabled={registering}>
                                    {registering && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                    Create & Register
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </div>
            </CardContent>
        </Card>
    )
}
