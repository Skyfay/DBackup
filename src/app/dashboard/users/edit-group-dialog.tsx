"use client"

import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
    Dialog,
    DialogContent,
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
    FormDescription
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"
import { updateGroup } from "@/app/actions/auth/group"
import { PermissionPicker } from "@/components/permissions/permission-picker"
import { GroupWithStats } from "@/types"

const formSchema = z.object({
    name: z.string().min(1, "Name is required"),
    permissions: z.array(z.string()).refine((value) => value.some((item) => item), {
        message: "You have to select at least one permission.",
    }),
})

interface EditGroupDialogProps {
    group: GroupWithStats
    open: boolean
    onOpenChange: (open: boolean) => void
}

export function EditGroupDialog({ group, open, onOpenChange }: EditGroupDialogProps) {
    const [loading, setLoading] = useState(false)

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            name: "",
            permissions: [],
        },
    })

    useEffect(() => {
        if (group) {
            form.reset({
                name: group.name,
                permissions: group.permissions,
            })
        }
    }, [group, form])

    async function onSubmit(values: z.infer<typeof formSchema>) {
        setLoading(true)
        try {
            const result = await updateGroup(group.id, values)
            if (result.success) {
                toast.success("Group updated successfully")
                onOpenChange(false)
            } else {
                toast.error(result.error)
            }
        } catch (_error) {
            toast.error("An unexpected error occurred")
        } finally {
            setLoading(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent tone="edit" className="sm:max-w-4xl max-h-[90vh] p-0">
                <DialogHeader className="p-6 pb-0">
                    <DialogTitle>Edit Group</DialogTitle>
                </DialogHeader>
                <ScrollArea className="max-h-[calc(90vh-8rem)] px-6">
                <Form {...form}>
                    <form id="edit-group-form" onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                        <FormField
                            control={form.control}
                            name="name"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Group Name</FormLabel>
                                    <FormControl>
                                        <Input placeholder="Admins" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="permissions"
                            render={({ field }) => (
                                <FormItem>
                                    <div className="mb-4">
                                        <FormLabel className="text-base">Permissions</FormLabel>
                                        <FormDescription>
                                            Select the permissions for this group.
                                        </FormDescription>
                                    </div>
                                    <PermissionPicker
                                        value={field.value}
                                        onChange={field.onChange}
                                        idPrefix="edit-permission"
                                    />
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                    </form>
                </Form>
                </ScrollArea>
                <div className="p-6 pt-0">
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                            Cancel
                        </Button>
                        <Button type="submit" form="edit-group-form" disabled={loading}>
                            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Save Changes
                        </Button>
                    </DialogFooter>
                </div>
            </DialogContent>
        </Dialog>
    )
}
