"use client"

import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { Button } from "@/components/ui/button"
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
    FormDescription,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { toast } from "sonner"
import { updateUser } from "@/app/actions/user"
import { uploadAvatar, removeAvatar } from "@/app/actions/upload"
import { User } from "@prisma/client"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { useRef, useState } from "react"
import { Loader2, Upload, Trash2, Check, ChevronsUpDown } from "lucide-react"
import { cn } from "@/lib/utils"
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const formSchema = z.object({
    name: z.string().min(2, {
        message: "Name must be at least 2 characters.",
    }),
    email: z.string().email({
        message: "Please enter a valid email address.",
    }),
    timezone: z.string().optional(),
    dateFormat: z.string().optional(),
    timeFormat: z.string().optional(),
})

interface ProfileFormProps {
    user: User
}

export function ProfileForm({ user }: ProfileFormProps) {
    const [isUploading, setIsUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(user.image);
    const [openTimezone, setOpenTimezone] = useState(false)

    const timezones = Intl.supportedValuesOf('timeZone')

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            name: user.name || "",
            email: user.email || "",
            timezone: user.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
            dateFormat: user.dateFormat || "P",
            timeFormat: user.timeFormat || "p",
        },
    })

    async function onSubmit(values: z.infer<typeof formSchema>) {
        toast.promise(updateUser(user.id, values), {
            loading: 'Updating profile...',
            success: (data) => {
                if(data.success) {
                    // Force a hard reload to update session data globally
                    window.location.reload();
                    return 'Profile updated successfully';
                } else {
                    throw new Error(data.error)
                }
            },
            error: (err) => `Error: ${err.message}`
        });
    }

    const handleAvatarClick = () => {
        fileInputRef.current?.click();
    }

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setIsUploading(true);
        const formData = new FormData();
        formData.append("file", file);

        try {
            const result = await uploadAvatar(formData);
            if (result.success && result.url) {
                setPreviewUrl(result.url);
                toast.success("Avatar updated successfully");
            } else {
                toast.error(result.error || "Failed to update avatar");
            }
        } catch {
            toast.error("An error occurred while uploading");
        } finally {
            setIsUploading(false);
            // Reset input
            if (fileInputRef.current) {
                fileInputRef.current.value = "";
            }
        }
    }

    const handleRemoveAvatar = async () => {
        setIsUploading(true);
        try {
            const result = await removeAvatar();
            if (result.success) {
                setPreviewUrl(null);
                toast.success("Avatar removed successfully");
            } else {
                toast.error(result.error || "Failed to remove avatar");
            }
        } catch {
            toast.error("An error occurred while removing avatar");
        } finally {
            setIsUploading(false);
        }
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>Profile</CardTitle>
                <CardDescription>
                    Update your personal information.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <div className="flex items-center gap-6 mb-8 group">
                    <div className="relative">
                        <Avatar className="h-20 w-20 cursor-pointer hover:opacity-80 transition-opacity" onClick={handleAvatarClick}>
                            <AvatarImage src={previewUrl || undefined} alt={user.name} className="object-cover" />
                            <AvatarFallback className="text-lg">{user.name?.charAt(0).toUpperCase()}</AvatarFallback>
                            {isUploading && (
                                <div className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-full">
                                    <Loader2 className="h-6 w-6 animate-spin text-white" />
                                </div>
                            )}
                        </Avatar>
                        <Button
                            variant="outline"
                            size="icon"
                            className="absolute -bottom-2 -right-2 h-8 w-8 rounded-full shadow-sm"
                            onClick={handleAvatarClick}
                            disabled={isUploading}
                        >
                            <Upload className="h-4 w-4" />
                        </Button>
                    </div>

                    <div className="space-y-1">
                        <h4 className="text-sm font-medium leading-none">{user.name}</h4>
                        <p className="text-sm text-muted-foreground">{user.email}</p>
                        <Input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            ref={fileInputRef}
                            onChange={handleFileChange}
                        />
                        {previewUrl ? (
                            <Button
                                variant="destructive"
                                size="sm"
                                className="mt-2 h-8"
                                onClick={handleRemoveAvatar}
                                disabled={isUploading}
                            >
                                <Trash2 className="mr-2 h-3 w-3" />
                                Remove Avatar
                            </Button>
                        ) : (
                            <Button
                                variant="outline"
                                size="sm"
                                className="mt-2 h-8"
                                onClick={handleAvatarClick}
                                disabled={isUploading}
                            >
                                Upload Avatar
                            </Button>
                        )}
                    </div>
                </div>

                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 max-w-md">
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
                                    <FormDescription>
                                        This is the email you use to sign in.
                                    </FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                         <FormField
                            control={form.control}
                            name="timezone"
                            render={({ field }) => (
                                <FormItem className="flex flex-col">
                                    <FormLabel>Timezone</FormLabel>
                                    <Popover open={openTimezone} onOpenChange={setOpenTimezone}>
                                        <PopoverTrigger asChild>
                                            <FormControl>
                                                <Button
                                                    variant="outline"
                                                    role="combobox"
                                                    aria-expanded={openTimezone}
                                                    className={cn(
                                                        "w-full justify-between",
                                                        !field.value && "text-muted-foreground"
                                                    )}
                                                >
                                                    {field.value
                                                        ? timezones.find((timezone) => timezone === field.value)
                                                        : "Select timezone"}
                                                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                                </Button>
                                            </FormControl>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-75 p-0">
                                            <Command>
                                                <CommandInput placeholder="Search timezone..." />
                                                <CommandList>
                                                    <CommandEmpty>No timezone found.</CommandEmpty>
                                                    <CommandGroup>
                                                        {timezones.map((timezone) => (
                                                            <CommandItem
                                                                value={timezone}
                                                                key={timezone}
                                                                onSelect={() => {
                                                                    form.setValue("timezone", timezone)
                                                                    setOpenTimezone(false)
                                                                }}
                                                            >
                                                                <Check
                                                                    className={cn(
                                                                        "mr-2 h-4 w-4",
                                                                        timezone === field.value
                                                                            ? "opacity-100"
                                                                            : "opacity-0"
                                                                    )}
                                                                />
                                                                {timezone}
                                                            </CommandItem>
                                                        ))}
                                                    </CommandGroup>
                                                </CommandList>
                                            </Command>
                                        </PopoverContent>
                                    </Popover>
                                    <FormDescription>
                                        This will be used for displaying dates and times in your dashboard.
                                    </FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <FormField
                                control={form.control}
                                name="dateFormat"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Date Format</FormLabel>
                                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                                            <FormControl>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Select date format" />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                <SelectItem value="P">Localized (01/14/2026)</SelectItem>
                                                <SelectItem value="PP">Medium (Jan 14, 2026)</SelectItem>
                                                <SelectItem value="PPP">Long (January 14th, 2026)</SelectItem>
                                                <SelectItem value="yyyy-MM-dd">ISO (2026-01-14)</SelectItem>
                                                <SelectItem value="dd.MM.yyyy">European (14.01.2026)</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        <FormDescription>
                                            How dates are displayed across the application.
                                        </FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="timeFormat"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Time Format</FormLabel>
                                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                                            <FormControl>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Select time format" />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                <SelectItem value="p">Localized (12:00 AM)</SelectItem>
                                                <SelectItem value="pp">Medium (12:00:00 AM)</SelectItem>
                                                <SelectItem value="HH:mm">24 Hour (14:30)</SelectItem>
                                                <SelectItem value="HH:mm:ss">24 Hour w/ Seconds (14:30:15)</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        <FormDescription>
                                            How times are displayed across the application.
                                        </FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>
                        <Button type="submit">Save Changes</Button>
                    </form>
                </Form>
            </CardContent>
        </Card>
    )
}
