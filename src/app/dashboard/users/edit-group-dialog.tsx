"use client"

import { Button } from "@/components/ui/button"
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
import { Checkbox } from "@/components/ui/checkbox"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"
import { updateGroup } from "@/app/actions/group"
import { AVAILABLE_PERMISSIONS } from "@/lib/permissions"
import { ScrollArea } from "@/components/ui/scroll-area"
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

    // Group permissions by category
    const groupedPermissions = AVAILABLE_PERMISSIONS.reduce((acc, permission) => {
        if (!acc[permission.category]) {
            acc[permission.category] = [];
        }
        acc[permission.category].push(permission);
        return acc;
    }, {} as Record<string, typeof AVAILABLE_PERMISSIONS>);


    const toggleCategory = (category: string) => {
        const categoryPermissions = groupedPermissions[category].map(p => p.id);
        const current = form.getValues("permissions");
        const allSelected = categoryPermissions.every(p => current.includes(p));

        if (allSelected) {
            // Deselect all
            form.setValue("permissions", current.filter(p => !categoryPermissions.includes(p as any)));
        } else {
            // Select all
            const newPermissions = [...new Set([...current, ...categoryPermissions])];
            form.setValue("permissions", newPermissions);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[600px]">
                <DialogHeader>
                    <DialogTitle>Edit Group</DialogTitle>
                </DialogHeader>
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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
                                    <ScrollArea className="h-[300px] border rounded-md p-4">
                                        <div className="space-y-6">
                                            {Object.entries(groupedPermissions).map(([category, permissions]) => (
                                                <div key={category} className="space-y-3">
                                                    <div className="flex items-center justify-between">
                                                        <h4 className="font-medium text-sm text-foreground/80">{category}</h4>
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="sm"
                                                            className="h-6 text-xs"
                                                            onClick={() => toggleCategory(category)}
                                                        >
                                                            Toggle All
                                                        </Button>
                                                    </div>
                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                        {permissions.map((permission) => (
                                                            <div
                                                                key={permission.id}
                                                                className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-3 shadow-sm hover:bg-accent/50 transition-colors"
                                                            >
                                                                <FormControl>
                                                                    <Checkbox
                                                                        id={`edit-permission-${permission.id}`}
                                                                        checked={field.value?.includes(permission.id)}
                                                                        onCheckedChange={(checked) => {
                                                                            return checked
                                                                                ? field.onChange([...field.value, permission.id])
                                                                                : field.onChange(
                                                                                    field.value?.filter(
                                                                                        (value) => value !== permission.id
                                                                                    )
                                                                                )
                                                                        }}
                                                                    />
                                                                </FormControl>
                                                                <div className="space-y-1 leading-none">
                                                                    <label
                                                                        htmlFor={`edit-permission-${permission.id}`}
                                                                        className="text-sm font-normal cursor-pointer leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                                                                    >
                                                                        {permission.label}
                                                                    </label>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </ScrollArea>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                                Cancel
                            </Button>
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
