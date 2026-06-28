"use client"

import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
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
import { useState } from "react"
import { toast } from "sonner"
import { Loader2, Plus } from "lucide-react"
import { createGroup } from "@/app/actions/auth/group"
import { PermissionPicker } from "@/components/permissions/permission-picker"

const formSchema = z.object({
    name: z.string().min(1, "Name is required"),
    permissions: z.array(z.string()).refine((value) => value.some((item) => item), {
        message: "You have to select at least one permission.",
    }),
})

export function CreateGroupDialog() {
    const [open, setOpen] = useState(false)
    const [loading, setLoading] = useState(false)

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            name: "",
            permissions: [],
        },
    })

    async function onSubmit(values: z.infer<typeof formSchema>) {
        setLoading(true)
        try {
            const result = await createGroup(values)
            if (result.success) {
                toast.success("Group created successfully")
                setOpen(false)
                form.reset()
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
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button>
                    <Plus className="mr-2 h-4 w-4" />
                    Create Group
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-4xl max-h-[90vh] p-0">
                <DialogHeader className="p-6 pb-0 shrink-0">
                    <DialogTitle>Create Group</DialogTitle>
                    <DialogDescription className="sr-only">
                        Create a new permission group and assign permissions.
                    </DialogDescription>
                </DialogHeader>
                <ScrollArea className="px-6 pb-4 *:data-radix-scroll-area-viewport:max-h-[calc(90vh-10rem)]">
                <Form {...form}>
                    <form id="create-group-form" onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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
                                        idPrefix="create-permission"
                                    />
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                    </form>
                </Form>
                </ScrollArea>
                <DialogFooter className="p-6 pt-0 shrink-0">
                    <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                        Cancel
                    </Button>
                    <Button type="submit" form="create-group-form" disabled={loading}>
                        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Create Group
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
