"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { Button } from "@/components/ui/button"
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { toast } from "sonner"
import { updateSystemSettings } from "@/app/actions/settings"
import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Loader2 } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

const formSchema = z.object({
    maxConcurrentJobs: z.coerce.number().min(1).max(10),
})

interface SystemSettingsFormProps {
    initialMaxConcurrentJobs: number;
}

export function SystemSettingsForm({ initialMaxConcurrentJobs }: SystemSettingsFormProps) {
    const [isPending, setIsPending] = useState(false)

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            maxConcurrentJobs: initialMaxConcurrentJobs,
        },
    })

    async function onSubmit(values: z.infer<typeof formSchema>) {
        setIsPending(true)
        try {
            const result = await updateSystemSettings(values)
            if (result.success) {
                toast.success("Settings updated successfully")
            } else {
                toast.error(result.error || "Failed to update settings")
            }
        } catch {
            toast.error("Something went wrong")
        } finally {
            setIsPending(false)
        }
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>Job Execution</CardTitle>
                <CardDescription>
                    Configure how jobs are executed on the server.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                        <FormField
                            control={form.control}
                            name="maxConcurrentJobs"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Max Concurrent Jobs</FormLabel>
                                    <Select
                                        onValueChange={field.onChange}
                                        defaultValue={String(field.value)}
                                    >
                                        <FormControl>
                                            <SelectTrigger>
                                                <SelectValue placeholder="Select limit" />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            {Array.from({ length: 10 }, (_, i) => i + 1).map((num) => (
                                                <SelectItem key={num} value={String(num)}>
                                                    {num} Job{num > 1 ? "s" : ""}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <FormDescription>
                                        The maximum number of backup jobs that can run simultaneously.
                                        Jobs will be queued if this limit is reached.
                                    </FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <Button type="submit" disabled={isPending}>
                            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Save Changes
                        </Button>
                    </form>
                </Form>
            </CardContent>
        </Card>
    )
}
