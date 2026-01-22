"use client";

import { SsoProvider } from "@prisma/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Trash2, ShieldCheck, Box, Settings2, Globe, CheckCircle2, UserPlus, UserX, Copy } from "lucide-react";
import { deleteSsoProvider, toggleSsoProvider } from "@/app/actions/oidc";
import { toast } from "sonner";
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
} from "@/components/ui/alert-dialog";
import { useState } from "react";

interface SsoProviderListProps {
    providers: SsoProvider[];
}

export function SsoProviderList({ providers }: SsoProviderListProps) {
    if (providers.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center p-8 border border-dashed rounded-lg bg-muted/20 text-center">
                <Globe className="h-10 w-10 text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium">No Identity Providers Configured</h3>
                <p className="text-sm text-muted-foreground mt-2 max-w-sm">
                    Connect an external identity provider like Authentik or PocketID to enable Single Sign-On for your users.
                </p>
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {providers.map((provider) => (
                <ProviderCard key={provider.id} provider={provider} />
            ))}
        </div>
    );
}

function ProviderCard({ provider }: { provider: SsoProvider }) {
    const [isDeleting, setIsDeleting] = useState(false);

    const handleDelete = async () => {
        setIsDeleting(true);
        try {
            const res = await deleteSsoProvider(provider.id);
            if (res.success) {
                toast.success("Provider removed");
            } else {
                toast.error(res.error || "Failed to remove provider");
            }
        } catch (e) {
            toast.error("Error removing provider");
        } finally {
            setIsDeleting(false);
        }
    };

    const handleToggle = async (checked: boolean) => {
        try {
            const res = await toggleSsoProvider(provider.id, checked);
            if (res.success) {
                toast.success(checked ? "Provider enabled" : "Provider disabled");
            } else {
                toast.error(res.error || "Failed to update status");
            }
        } catch (e) {
             toast.error("Error updating status");
        }
    };

    const getIcon = () => {
        switch (provider.adapterId) {
            case "authentik": return ShieldCheck;
            case "pocket-id": return Box;
            case "generic": return Settings2;
            default: return Globe;
        }
    };

    const Icon = getIcon();

    return (
        <Card className="flex flex-col">
            <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                <div className="flex items-center space-x-3">
                    <div className="p-2 rounded-md bg-muted text-primary">
                        <Icon className="h-5 w-5" />
                    </div>
                    <div>
                        <CardTitle className="text-base font-semibold">{provider.name}</CardTitle>
                        <CardDescription className="text-xs font-mono mt-1">{provider.providerId}</CardDescription>
                    </div>
                </div>
                <Switch
                    checked={provider.enabled}
                    onCheckedChange={handleToggle}
                />
            </CardHeader>
            <CardContent className="flex-1 pt-4">
                 <div className="space-y-2 text-sm">
                    <div className="flex justify-between border-b pb-2">
                        <span className="text-muted-foreground">Type</span>
                        <Badge variant="outline" className="capitalize">{provider.adapterId}</Badge>
                    </div>
                    <div className="flex justify-between border-b pb-2">
                         <span className="text-muted-foreground">Issuer</span>
                         <span className="truncate max-w-[150px]" title={provider.issuer || ""}>{provider.issuer}</span>
                    </div>                    <div className="flex flex-col border-b pb-2 gap-1">
                         <span className="text-muted-foreground">Callback URL</span>
                         <div className="flex items-center gap-2 bg-muted/50 p-1 rounded border">
                            <code className="text-[10px] flex-1 font-mono truncate select-all">
                                {typeof window !== 'undefined' ? window.location.origin : ''}/api/auth/callback/{provider.providerId}
                            </code>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-5 w-5 hover:bg-background"
                                onClick={() => {
                                    const url = `${window.location.origin}/api/auth/callback/${provider.providerId}`;
                                    navigator.clipboard.writeText(url);
                                    toast.success("Copied to clipboard");
                                }}
                            >
                                <Copy className="h-3 w-3" />
                            </Button>
                         </div>
                    </div>                     <div className="flex items-center text-xs text-muted-foreground pt-2">
                        <CheckCircle2 className="h-3 w-3 mr-1 text-green-500" />
                        Auth & Token endpoints configured
                    </div>
                     <div className="flex items-center text-xs text-muted-foreground pt-1">
                        {provider.allowProvisioning ? (
                            <>
                                <UserPlus className="h-3 w-3 mr-1" />
                                Auto-provisioning enabled
                            </>
                        ) : (
                             <>
                                <UserX className="h-3 w-3 mr-1" />
                                Auto-provisioning disabled
                            </>
                        )}
                    </div>
                 </div>
            </CardContent>
            <CardFooter className="bg-muted/20 p-3 flex justify-end">
                <AlertDialog>
                    <AlertDialogTrigger asChild>
                         <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10">
                            <Trash2 className="h-4 w-4 mr-2" />
                            Remove
                        </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                            <AlertDialogDescription>
                                This will permanently remove the <b>{provider.name}</b> SSO provider.
                                Users who authenticated via this provider may lose access if they don&apos;t have a password set.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                                {isDeleting ? "Deleting..." : "Delete Provider"}
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </CardFooter>
        </Card>
    );
}
