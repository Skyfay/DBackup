"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ExternalLink, CheckCircle2, AlertCircle, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface OneDriveOAuthButtonProps {
    /** The OAUTH credential profile id to authorize */
    credentialId?: string;
    /** Whether the profile already has a refresh token */
    authorized?: boolean;
    /** Called when authorization completes successfully in the popup. */
    onAuthorized?: () => void;
}

/**
 * OAuth authorization button for OneDrive.
 * Authorizes the selected OAUTH credential profile - no saved destination needed.
 */
export function OneDriveOAuthButton({ credentialId, authorized, onAuthorized }: OneDriveOAuthButtonProps) {
    const [isLoading, setIsLoading] = useState(false);
    const [tokenCheck, setTokenCheck] = useState<{ id: string; auth: boolean; result: "valid" | "expired" } | null>(null);

    const tokenState: "checking" | "valid" | "expired" | null =
        !authorized || !credentialId ? null
        : tokenCheck?.id === credentialId && tokenCheck?.auth === authorized ? tokenCheck.result
        : "checking";

    useEffect(() => {
        if (!authorized || !credentialId) {
            return;
        }
        let active = true;
        fetch("/api/adapters/onedrive/validate-token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ credentialId }),
        })
            .then((r) => r.json())
            .then((data) => { if (active) setTokenCheck({ id: credentialId, auth: !!authorized, result: data.valid ? "valid" : "expired" }); })
            .catch(() => { if (active) setTokenCheck({ id: credentialId, auth: !!authorized, result: "valid" }); });
        return () => { active = false; };
    }, [authorized, credentialId]);

    if (!credentialId) {
        return (
            <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                    Select or create an OAuth credential profile (with the client ID + secret) first, then authorize with Microsoft.
                </AlertDescription>
            </Alert>
        );
    }

    if (authorized && tokenState === "checking") {
        return (
            <Alert className="border-muted items-center [&>svg]:translate-y-0">
                <Loader2 className="h-4 w-4 animate-spin" />
                <AlertDescription className="text-muted-foreground">Verifying OneDrive authorization...</AlertDescription>
            </Alert>
        );
    }

    if (authorized && tokenState === "expired") {
        return (
            <Alert className="border-amber-500/30 bg-amber-500/5 items-center [&>svg]:translate-y-0">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <AlertDescription className="flex items-center justify-between">
                    <span className="text-amber-600">Authorization expired. Please re-authorize with Microsoft.</span>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleAuthorize()}
                        disabled={isLoading}
                    >
                        {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ExternalLink className="h-4 w-4 mr-2" />}
                        Re-authorize
                    </Button>
                </AlertDescription>
            </Alert>
        );
    }

    if (authorized && (tokenState === "valid" || tokenState === null)) {
        return (
            <Alert className="border-green-500/30 bg-green-500/5 items-center [&>svg]:translate-y-0">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <AlertDescription className="flex items-center justify-between">
                    <span className="text-green-600">OneDrive is authorized.</span>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleAuthorize()}
                        disabled={isLoading}
                    >
                        {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ExternalLink className="h-4 w-4 mr-2" />}
                        Re-authorize
                    </Button>
                </AlertDescription>
            </Alert>
        );
    }

    async function handleAuthorize() {
        setIsLoading(true);
        try {
            const res = await fetch("/api/adapters/onedrive/auth", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ credentialId }),
            });

            const data = await res.json();

            if (data.success && data.data?.authUrl) {
                const popup = window.open(
                    data.data.authUrl,
                    "dbackup_oauth",
                    "width=600,height=700,scrollbars=yes,resizable=yes"
                );

                if (!popup) {
                    window.location.href = data.data.authUrl;
                    return;
                }

                const handleMessage = (event: MessageEvent) => {
                    if (event.origin !== window.location.origin) return;
                    if (event.data?.type !== "oauth_complete") return;
                    window.removeEventListener("message", handleMessage);
                    clearInterval(pollClosed);
                    setIsLoading(false);
                    if (event.data.status === "success") {
                        toast.success(event.data.message);
                        onAuthorized?.();
                    } else {
                        toast.error(event.data.message);
                    }
                };

                window.addEventListener("message", handleMessage);

                const pollClosed = setInterval(() => {
                    if (popup.closed) {
                        clearInterval(pollClosed);
                        window.removeEventListener("message", handleMessage);
                        setIsLoading(false);
                    }
                }, 500);
            } else {
                toast.error(data.error || "Failed to start authorization");
                setIsLoading(false);
            }
        } catch {
            toast.error("Failed to start Microsoft authorization");
            setIsLoading(false);
        }
    }

    return (
        <div className="space-y-3">
            <Alert className="border-amber-500/30 bg-amber-500/5">
                <AlertCircle className="h-4 w-4 text-amber-600" />
                <AlertDescription className="text-amber-600">
                    OneDrive requires OAuth authorization. Click the button below to connect your Microsoft account.
                </AlertDescription>
            </Alert>
            <Button
                type="button"
                variant="default"
                onClick={handleAuthorize}
                disabled={isLoading}
                className="w-full"
            >
                {isLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                    <ExternalLink className="h-4 w-4 mr-2" />
                )}
                Authorize with Microsoft
            </Button>
        </div>
    );
}
