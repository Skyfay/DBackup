"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ExternalLink, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface OneDriveOAuthButtonProps {
    /** The saved adapter config ID (from database) */
    adapterId?: string;
    /** Whether a refresh token already exists */
    hasRefreshToken?: boolean;
}

/**
 * OAuth authorization button for OneDrive.
 * Must only be shown AFTER the adapter config is saved (needs the DB ID).
 */
export function OneDriveOAuthButton({ adapterId, hasRefreshToken }: OneDriveOAuthButtonProps) {
    const [isLoading, setIsLoading] = useState(false);

    if (!adapterId) {
        return (
            <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                    Save the configuration first, then you can authorize with Microsoft.
                </AlertDescription>
            </Alert>
        );
    }

    if (hasRefreshToken) {
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
                body: JSON.stringify({ adapterId }),
            });

            const data = await res.json();

            if (data.success && data.data?.authUrl) {
                // Redirect to Microsoft consent screen
                window.location.href = data.data.authUrl;
            } else {
                toast.error(data.error || "Failed to start authorization");
            }
        } catch {
            toast.error("Failed to start Microsoft authorization");
        } finally {
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
