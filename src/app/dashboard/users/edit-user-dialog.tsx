"use client"

import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { useState, useEffect } from "react"
import { toast } from "sonner"
import { Loader2, ShieldAlert } from "lucide-react"
import { updateUser, updateUserGroup, resetUserTwoFactor } from "@/app/actions/user"
import { User, Group } from "@prisma/client"
import { GroupWithStats } from "@/types"

const formSchema = z.object({
    name: z.string().min(2, "Name must be at least 2 characters."),
    email: z.string().email("Invalid email address."),
    groupId: z.string().optional(),
})

export interface EditUserDialogProps {
    user: User & { group?: Group | null } | null;
    groups: GroupWithStats[];
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function EditUserDialogComponent({ user, groups, open, onOpenChange }: EditUserDialogProps) {
    const [loading, setLoading] = useState(false)
    const [resetting2FA, setResetting2FA] = useState(false)

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            name: "",
            email: "",
            groupId: "none",
        },
    })

    useEffect(() => {
        if (user) {
            form.reset({
                name: user.name,
                email: user.email,
                groupId: user.group?.id || "none",
            })
        }
    }, [user, form])

    async function onSubmit(values: z.infer<typeof formSchema>) {
        if (!user) return;
        setLoading(true)
        try {
            // Update profile
            const profileRes = await updateUser(user.id, {
                 name: values.name,
                 email: values.email
            });

            if (!profileRes.success) {
                  throw new Error(profileRes.error as string);
            }

            // Update group if changed
            const currentGroupId = user.group?.id || "none";
            const newGroupId = values.groupId || "none";

            if (currentGroupId !== newGroupId) {
                 const groupRes = await updateUserGroup(user.id, newGroupId);
                 if (!groupRes.success) {
                     throw new Error(groupRes.error as string);
                 }
            }

            toast.success("User updated successfully");
            onOpenChange(false);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : "An error occurred";
            toast.error(message);
        } finally {
            setLoading(false)
        }
    }

    const handleReset2FA = async () => {
        if (!user) return;
        setResetting2FA(true);
        try {
            const res = await resetUserTwoFactor(user.id);
            if (res.success) {
                toast.success("2FA has been disabled for this user.");
                onOpenChange(false);
            } else {
                toast.error(res.error || "Failed to reset 2FA.");
            }
        } catch {
            toast.error("An error occurred.");
        } finally {
            setResetting2FA(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-106.25">
                <DialogHeader>
                    <DialogTitle>Edit User</DialogTitle>
                    <DialogDescription>
                        Make changes to the user&apos;s profile and access level here.
                    </DialogDescription>
                </DialogHeader>
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                        <FormField
                            control={form.control}
                            name="name"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Name</FormLabel>
                                    <FormControl>
                                        <Input placeholder="John Doe" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="email"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Email</FormLabel>
                                    <FormControl>
                                        <Input placeholder="john@example.com" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="groupId"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Group Assignment</FormLabel>
                                    <Select
                                        onValueChange={field.onChange}
                                        defaultValue={field.value}
                                        value={field.value}
                                    >
                                        <FormControl>
                                            <SelectTrigger>
                                                <SelectValue placeholder="Select a group" />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            <SelectItem value="none">No Group</SelectItem>
                                            {groups.map((group) => (
                                                <SelectItem key={group.id} value={group.id}>
                                                    {group.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <DialogFooter className="sm:justify-between">
                            {(user?.twoFactorEnabled || user?.passkeyTwoFactor) ? (
                                <Button
                                    type="button"
                                    variant="destructive"
                                    onClick={handleReset2FA}
                                    disabled={resetting2FA || loading}
                                >
                                    {resetting2FA ? (
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    ) : (
                                        <ShieldAlert className="mr-2 h-4 w-4" />
                                    )}
                                    Reset 2FA
                                </Button>
                            ) : (
                                <div /> /* Spacer to keep Save button on right if 2FA not enabled, or just let standard behavior handle it */
                            )}
                            <Button type="submit" disabled={loading}>
                                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                Save Changes
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    )
}
