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
import { uploadAvatar } from "@/app/actions/upload"
import { User } from "@prisma/client"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { useRef, useState } from "react"
import { Loader2, Upload } from "lucide-react"

const formSchema = z.object({
    name: z.string().min(2, {
        message: "Name must be at least 2 characters.",
    }),
    email: z.string().email({
        message: "Please enter a valid email address.",
    }),
})

interface ProfileFormProps {
    user: User
}

export function ProfileForm({ user }: ProfileFormProps) {
    const [isUploading, setIsUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(user.image);

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            name: user.name || "",
            email: user.email || "",
        },
    })

    async function onSubmit(values: z.infer<typeof formSchema>) {
        toast.promise(updateUser(user.id, values), {
            loading: 'Updating profile...',
            success: (data) => {
                if(data.success) {
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
        } catch (error) {
            toast.error("An error occurred while uploading");
        } finally {
            setIsUploading(false);
            // Reset input
            if (fileInputRef.current) {
                fileInputRef.current.value = "";
            }
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
                            <AvatarImage src={previewUrl || ""} alt={user.name} className="object-cover" />
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
                        <Button variant="ghost" size="sm" className="mt-2" onClick={handleAvatarClick} disabled={isUploading}>
                            Change Avatar
                        </Button>
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
                        <Button type="submit">Save Changes</Button>
                    </form>
                </Form>
            </CardContent>
        </Card>
    )
}
