"use client";

import { useState } from "react";
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
import { OIDC_ADAPTERS } from "@/services/oidc-registry";
import { DynamicOidcForm } from "./dynamic-oidc-form";
import { toast } from "sonner";
import { createSsoProvider } from "@/app/actions/oidc";
import { OIDCAdapter } from "@/lib/core/oidc-adapter";
import { PlusCircle, ShieldCheck, Box, Settings2, Globe } from "lucide-react";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";

export function AddSsoProviderDialog() {
    const [open, setOpen] = useState(false);
    const [step, setStep] = useState<1 | 2>(1);
    const [selectedAdapter, setSelectedAdapter] = useState<OIDCAdapter | null>(null);

    // Form State
    const [name, setName] = useState("");
    const [providerId, setProviderId] = useState("");
    const [clientId, setClientId] = useState("");
    const [clientSecret, setClientSecret] = useState("");
    const [adapterConfig, setAdapterConfig] = useState<Record<string, any>>({});
    const [allowProvisioning, setAllowProvisioning] = useState(true);

    const [isLoading, setIsLoading] = useState(false);

    const handleAdapterSelect = (adapter: OIDCAdapter) => {
        setSelectedAdapter(adapter);
        // Reset dynamic config
        setAdapterConfig({});
        // Suggest a name/providerId based on adapter
        const randomSuffix = Math.floor(Math.random() * 1000);
        if (!name) setName(adapter.name);
        if (!providerId) setProviderId(`${adapter.id}-${randomSuffix}`);

        setStep(2);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedAdapter) return;

        setIsLoading(true);

        try {
            const res = await createSsoProvider({
                name,
                providerId,
                adapterId: selectedAdapter.id,
                clientId,
                clientSecret,
                adapterConfig,
                allowProvisioning
            });

            if (res.success) {
                toast.success("SSO Provider created successfully");
                setOpen(false);
                resetForm();
            } else {
                 if (res.error && typeof res.error === 'object' && 'details' in res.error) {
                     // Zod error from backend adapter config validation
                     toast.error("Invalid Configuration: Check inputs");
                     // You could map these errors to fields if you want to be fancy
                 } else {
                    toast.error(typeof res.error === 'string' ? res.error : "Failed to create provider");
                 }
            }
        } catch (error) {
            toast.error("An unexpected error occurred");
        } finally {
            setIsLoading(false);
        }
    };

    const resetForm = () => {
        setStep(1);
        setSelectedAdapter(null);
        setName("");
        setProviderId("");
        setClientId("");
        setClientSecret("");
        setAllowProvisioning(true);
        setAdapterConfig({});
    };

    const getIcon = (id: string) => {
        switch (id) {
            case "authentik": return ShieldCheck;
            case "pocket-id": return Box;
            case "generic": return Settings2;
            default: return Globe;
        }
    }

    return (
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if(!v) resetForm(); }}>
            <DialogTrigger asChild>
                <Button><PlusCircle className="mr-2 h-4 w-4" /> Add Provider</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle>{step === 1 ? "Select Provider Type" : `Configure ${selectedAdapter?.name}`}</DialogTitle>
                    <DialogDescription>
                        {step === 1
                            ? "Choose an OIDC provider template to get started."
                            : "Enter the connection details for your Identity Provider."}
                    </DialogDescription>
                </DialogHeader>

                {step === 1 && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
                        {OIDC_ADAPTERS.map((adapter) => {
                             const Icon = getIcon(adapter.id);
                             return (
                                <button
                                    key={adapter.id}
                                    onClick={() => handleAdapterSelect(adapter)}
                                    className={cn(
                                        "flex flex-col items-start p-4 rounded-lg border hover:border-primary hover:bg-muted/50 transition-all text-left space-y-2",
                                        selectedAdapter?.id === adapter.id && "border-primary bg-muted"
                                    )}
                                >
                                    <div className="p-2 rounded-md bg-primary/10 text-primary">
                                        <Icon className="h-6 w-6" />
                                    </div>
                                    <div>
                                        <h3 className="font-medium">{adapter.name}</h3>
                                        <p className="text-sm text-muted-foreground line-clamp-2">{adapter.description}</p>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                )}

                {step === 2 && selectedAdapter && (
                    <form onSubmit={handleSubmit} className="space-y-6 py-4">
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
                                    pattern="^[a-z0-9\-_]+$"
                                    title="Only lowercase letters, numbers, dashes and underscores"
                                />
                            </div>
                        </div>

                         <div className="grid grid-cols-2 gap-4">
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
                        </div>

                        <div className="border-t pt-4">
                            <h4 className="text-sm font-medium mb-4 text-muted-foreground uppercase tracking-wider">Provider Configuration</h4>
                            <DynamicOidcForm
                                inputs={selectedAdapter.inputs}
                                value={adapterConfig}
                                onChange={(key, val) => setAdapterConfig(prev => ({ ...prev, [key]: val }))}
                                disabled={isLoading}
                            />
                        </div>
                         <div className="flex items-center space-x-2 border-t pt-4">
                            <Switch id="provisioning" checked={allowProvisioning} onCheckedChange={setAllowProvisioning} disabled={isLoading} />
                            <div className="grid gap-1.5 leading-none">
                                <Label htmlFor="provisioning">Auto-Provisioning</Label>
                                <p className="text-sm text-muted-foreground">
                                    Automatically create new users when they log in for the first time.
                                </p>
                            </div>
                        </div>
                        <DialogFooter className="gap-2">
                            <Button type="button" variant="outline" onClick={() => setStep(1)} disabled={isLoading}>Back</Button>
                            <Button type="submit" disabled={isLoading}>
                                {isLoading ? "Creating..." : "Create Provider"}
                            </Button>
                        </DialogFooter>
                    </form>
                )}
            </DialogContent>
        </Dialog>
    );
}
