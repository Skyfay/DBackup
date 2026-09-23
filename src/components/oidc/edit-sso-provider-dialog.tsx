"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getOIDCAdapter } from "@/services/sso/oidc-registry";
import { DynamicOidcForm } from "./dynamic-oidc-form";
import { toast } from "sonner";
import { updateSsoProvider } from "@/app/actions/auth/oidc";
import { OIDCAdapter } from "@/lib/core/oidc-adapter";
import { SsoProvider } from "@prisma/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Pencil } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";

const log = logger.child({ component: "EditSsoProviderDialog" });

interface EditSsoProviderDialogProps {
    provider: SsoProvider;
}

export function EditSsoProviderDialog({ provider }: EditSsoProviderDialogProps) {
    const [open, setOpen] = useState(false);

    // Form State
    const [name, setName] = useState(provider.name);
    const [providerId, setProviderId] = useState(provider.providerId);
    const [domain, setDomain] = useState(provider.domain || "");
    const [clientId, setClientId] = useState(provider.clientId || "");
    const [clientSecret, setClientSecret] = useState(provider.clientSecret || "");
    const [allowProvisioning, setAllowProvisioning] = useState(provider.allowProvisioning);

    const [adapterConfig, setAdapterConfig] = useState<Record<string, any>>({});
    const [adapter, setAdapter] = useState<OIDCAdapter | undefined>(undefined);

    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (open) {
            setName(provider.name);
            setProviderId(provider.providerId);
            setDomain(provider.domain || "");
            setClientId(provider.clientId || "");
            setClientSecret(provider.clientSecret || "");
            setAllowProvisioning(provider.allowProvisioning);
        }
    }, [open, provider]);

    useEffect(() => {
        const adp = getOIDCAdapter(provider.adapterId);
        setAdapter(adp);

        // Try to parse existing adapter config
        if ((provider as any).adapterConfig) {
            try {
                const config = JSON.parse((provider as any).adapterConfig);
                // Ensure non-empty config object
                if (Object.keys(config).length > 0) {
                     setAdapterConfig(config);
                     return;
                }
            } catch {
                // Fallback to reconstruction
            }
        }

        // Fallback: Reconstruct config from provider fields (for legacy providers)
        if (adp && provider.issuer) {
            const issuer = provider.issuer;
            const newConfig: Record<string, any> = {};

            try {
                if (adp.id === "keycloak") {
                    // Issuer: {baseUrl}/realms/{realm}
                    if (issuer.includes("/realms/")) {
                        const parts = issuer.split("/realms/");
                        newConfig.baseUrl = parts[0];
                        newConfig.realm = parts[1].replace(/\/$/, "");
                    }
                } else if (adp.id === "authentik") {
                    // Issuer: {baseUrl}/application/o/{slug}/
                    if (issuer.includes("/application/o/")) {
                        const parts = issuer.split("/application/o/");
                        newConfig.baseUrl = parts[0];
                        newConfig.slug = parts[1].replace(/\/$/, "");
                    }
                } else if (adp.id === "pocket-id" || adp.id === "authelia") {
                    // Issuer: {baseUrl} (usually)
                    newConfig.baseUrl = issuer;
                } else if (adp.id === "generic") {
                    newConfig.issuer = provider.issuer;
                    newConfig.authorizationEndpoint = provider.authorizationEndpoint;
                    newConfig.tokenEndpoint = provider.tokenEndpoint;
                    newConfig.userInfoEndpoint = provider.userInfoEndpoint;
                    newConfig.jwksEndpoint = provider.jwksEndpoint;
                }

                if (Object.keys(newConfig).length > 0) {
                     setAdapterConfig(newConfig);
                }
            } catch (e) {
                log.warn("Failed to reconstruct adapter config", {}, wrapError(e));
            }
        }
    }, [provider]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!adapter) return;

        setIsLoading(true);

        try {
            const res = await updateSsoProvider({
                id: provider.id,
                name,
                providerId,
                adapterId: provider.adapterId, // Adapter cannot be changed
                domain, // Send empty string explicitly if cleared
                clientId,
                clientSecret,
                adapterConfig,
                allowProvisioning
            });

            if (res.success) {
                toast.success("SSO Provider updated successfully");
                setOpen(false);
            } else {
                 const response = res as any;

                 if (response.details && response.details._errors?.length > 0) {
                    toast.error("Validation Error", {
                        description: response.details._errors[0],
                        duration: 15000
                    });
                 }
                 else if (res.error && typeof res.error === 'object') {
                     toast.error("Invalid Configuration: Check inputs");
                 }
                 else {
                    toast.error(typeof res.error === 'string' ? res.error : "Failed to update provider");
                 }
            }
        } catch (_error) {
            toast.error("An unexpected error occurred");
        } finally {
            setIsLoading(false);
        }
    };

    if (!adapter) return null;

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8">
                    <Pencil className="h-3.5 w-3.5 mr-2" />
                    Edit
                </Button>
            </DialogTrigger>
            <DialogContent tone="edit" className="max-w-2xl max-h-[90vh] p-0">
                <div className="px-6 pt-6 pb-4 shrink-0">
                    <DialogHeader>
                        <DialogTitle>Edit SSO Provider</DialogTitle>
                        <DialogDescription>
                            Modify configuration for {adapter.name}
                        </DialogDescription>
                    </DialogHeader>
                </div>

                <form onSubmit={handleSubmit}>
                <ScrollArea className="*:data-[slot=scroll-area-viewport]:max-h-[calc(90vh-10rem)]">
                <div className="space-y-6 px-6 pb-4">
                    <Tabs defaultValue="general" className="w-full">
                        <TabsList className="grid w-full grid-cols-3">
                            <TabsTrigger value="general">General</TabsTrigger>
                            <TabsTrigger value="auth">Credentials</TabsTrigger>
                            <TabsTrigger value="provider">Provider</TabsTrigger>
                        </TabsList>

                        {/* TAB 1: GENERAL SETTINGS */}
                        <TabsContent value="general" className="space-y-4 pt-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="name">Display Name</Label>
                                    <Input
                                        id="name"
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                        placeholder="Company Login"
                                        required
                                        disabled={isLoading}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="providerId">Provider ID (Internal)</Label>
                                    <Input
                                        id="providerId"
                                        value={providerId}
                                        onChange={(e) => setProviderId(e.target.value)}
                                        placeholder="authentik-prod"
                                        required
                                        disabled={isLoading}
                                        pattern="[a-z0-9\-_]+"
                                        title="Only lowercase letters, numbers, dashes and underscores"
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="domain">Email Domain (Optional)</Label>
                                <Input
                                    id="domain"
                                    value={domain}
                                    onChange={(e) => setDomain(e.target.value)}
                                    placeholder="example.com"
                                    disabled={isLoading}
                                />
                                <p className="text-xs text-muted-foreground">
                                    If set, this provider will only be used for email addresses ending in this domain.
                                </p>
                            </div>

                            <div className="flex items-center space-x-2 border-t pt-4 mt-4">
                                <Switch id="provisioning" checked={allowProvisioning} onCheckedChange={setAllowProvisioning} disabled={isLoading} />
                                <div className="grid gap-1.5 leading-none">
                                    <Label htmlFor="provisioning">Auto-Provisioning</Label>
                                    <p className="text-sm text-muted-foreground p-0 m-0">
                                        Automatically create new users when they log in for the first time.
                                    </p>
                                </div>
                            </div>
                        </TabsContent>

                        {/* TAB 2: CREDENTIALS */}
                        <TabsContent value="auth" className="space-y-4 pt-4">
                            <div className="space-y-2">
                                <Label htmlFor="clientId">Client ID</Label>
                                <Input
                                    id="clientId"
                                    value={clientId}
                                    onChange={(e) => setClientId(e.target.value)}
                                    required
                                    disabled={isLoading}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="clientSecret">Client Secret</Label>
                                <Input
                                    id="clientSecret"
                                    type="password"
                                    value={clientSecret}
                                    onChange={(e) => setClientSecret(e.target.value)}
                                    required
                                    disabled={isLoading}
                                />
                            </div>
                        </TabsContent>

                        {/* TAB 3: PROVIDER CONFIG */}
                        <TabsContent value="provider" className="space-y-4 pt-4">
                            <DynamicOidcForm
                                inputs={adapter.inputs}
                                value={adapterConfig}
                                onChange={(key, val) => setAdapterConfig(prev => ({ ...prev, [key]: val }))}
                                disabled={isLoading}
                            />
                        </TabsContent>
                    </Tabs>
                </div>
                </ScrollArea>

                <div className="px-6 pt-2 pb-6 shrink-0">
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isLoading}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={isLoading}>
                            {isLoading ? "Saving..." : "Save Changes"}
                        </Button>
                    </DialogFooter>
                </div>
                </form>
            </DialogContent>
        </Dialog>
    );
}
