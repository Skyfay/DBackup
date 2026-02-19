"use client"

import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import {
    Form,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
    FormDescription,
    FormControl,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { useState } from "react"
import { toast } from "sonner"
import { Loader2, Plus, CalendarIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { DateDisplay } from "@/components/utils/date-display"
import { createApiKey } from "@/app/actions/api-key"
import { PermissionPicker } from "@/components/permission-picker"
import { ApiKeyRevealDialog } from "./api-key-reveal-dialog"

const formSchema = z.object({
    name: z.string().min(1, "Name is required").max(100),
    permissions: z.array(z.string()).min(1, "At least one permission is required"),
    expiresAt: z.date().optional(),
})

export function CreateApiKeyDialog() {
    const [open, setOpen] = useState(false)
    const [loading, setLoading] = useState(false)
    const [revealedKey, setRevealedKey] = useState<string | null>(null)

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            name: "",
            permissions: [],
            expiresAt: undefined,
        },
    })

    async function onSubmit(values: z.infer<typeof formSchema>) {
        setLoading(true)
        try {
            const result = await createApiKey({
                name: values.name,
                permissions: values.permissions,
                expiresAt: values.expiresAt
                    ? values.expiresAt.toISOString()
                    : null,
            })

            if (result.success && result.data) {
                toast.success("API key created successfully")
                setRevealedKey(result.data.rawKey)
                setOpen(false)
                form.reset()
            } else {
                toast.error(result.error || "Failed to create API key")
            }
        } catch {
            toast.error("An unexpected error occurred")
        } finally {
            setLoading(false)
        }
    }

    return (
        <>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger asChild>
                    <Button>
                        <Plus className="mr-2 h-4 w-4" />
                        Create API Key
                    </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[600px]">
                    <DialogHeader>
                        <DialogTitle>Create API Key</DialogTitle>
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
                                            <Input placeholder="CI/CD Pipeline" {...field} />
                                        </FormControl>
                                        <FormDescription>
                                            A descriptive name to identify this key.
                                        </FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="expiresAt"
                                render={({ field }) => (
                                    <FormItem className="flex flex-col">
                                        <FormLabel>Expiration Date (optional)</FormLabel>
                                        <Popover>
                                            <PopoverTrigger asChild>
                                                <FormControl>
                                                    <Button
                                                        variant="outline"
                                                        className={cn(
                                                            "w-full pl-3 text-left font-normal",
                                                            !field.value && "text-muted-foreground"
                                                        )}
                                                    >
                                                        {field.value ? (
                                                            <DateDisplay date={field.value} format="PPP" />
                                                        ) : (
                                                            <span>Pick a date</span>
                                                        )}
                                                        <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                                    </Button>
                                                </FormControl>
                                            </PopoverTrigger>
                                            <PopoverContent className="w-auto p-0" align="start">
                                                <Calendar
                                                    mode="single"
                                                    selected={field.value}
                                                    onSelect={field.onChange}
                                                    disabled={(date) => date < new Date()}
                                                    autoFocus
                                                />
                                            </PopoverContent>
                                        </Popover>
                                        <FormDescription>
                                            Leave empty for a key that never expires.
                                        </FormDescription>
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
                                                Select the permissions this API key should have.
                                            </FormDescription>
                                        </div>
                                        <PermissionPicker
                                            value={field.value}
                                            onChange={field.onChange}
                                            idPrefix="apikey-permission"
                                            height="250px"
                                        />
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <DialogFooter>
                                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                                    Cancel
                                </Button>
                                <Button type="submit" disabled={loading}>
                                    {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                    Create Key
                                </Button>
                            </DialogFooter>
                        </form>
                    </Form>
                </DialogContent>
            </Dialog>

            {/* Show the raw key after creation */}
            <ApiKeyRevealDialog
                rawKey={revealedKey}
                open={!!revealedKey}
                onOpenChange={(open) => !open && setRevealedKey(null)}
            />
        </>
    )
}
