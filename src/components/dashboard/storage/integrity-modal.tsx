"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, ShieldX, Shield, Copy, Check, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DateDisplay } from "@/components/utils/date-display";
import { toast } from "sonner";
import { useUserPreferences } from "@/hooks/use-user-preferences";
import type { FileInfo } from "@/components/dashboard/storage/file-info";

interface IntegrityModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    file: FileInfo;
    storageConfigId: string;
    onVerifyComplete: () => void;
}

type LiveResult = {
    status: 'passed' | 'failed' | 'no_checksum' | 'no_metadata' | 'download_error';
    verifiedAt: string;
    actualChecksum?: string;
};

function CopyButton({ value }: { value: string }) {
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {}
    };

    return (
        <button
            onClick={handleCopy}
            className="ml-2 shrink-0 text-muted-foreground hover:text-foreground transition-colors"
            title="Copy to clipboard"
        >
            {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
    );
}

function ChecksumRow({ label, value }: { label: string; value?: string }) {
    if (!value) return null;
    return (
        <div className="flex items-start gap-3 py-2 border-b last:border-b-0">
            <span className="text-xs font-mono text-muted-foreground w-14 shrink-0 pt-px">{label}</span>
            <span className="text-xs font-mono break-all flex-1 text-foreground">{value}</span>
            <CopyButton value={value} />
        </div>
    );
}

function VerificationStatus({ verification, liveResult }: {
    verification: FileInfo['verification'];
    liveResult: LiveResult | null;
}) {
    const status = liveResult ?? (verification ? { status: verification.passed ? 'passed' : 'failed', verifiedAt: verification.verifiedAt } : null);

    if (!status) {
        return (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Shield className="h-4 w-4" />
                <span>Not yet verified</span>
            </div>
        );
    }

    if (status.status === 'passed') {
        return (
            <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                    <ShieldCheck className="h-4 w-4 shrink-0" />
                    <span className="font-medium">Passed</span>
                </div>
                <p className="text-xs text-muted-foreground pl-6">
                    Verified <DateDisplay date={status.verifiedAt} format="PP p" />
                    {liveResult ? null : verification?.trigger ? ` via ${verification.trigger}` : null}
                </p>
            </div>
        );
    }

    if (status.status === 'failed') {
        return (
            <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
                    <ShieldX className="h-4 w-4 shrink-0" />
                    <span className="font-medium">Failed - backup may be corrupted</span>
                </div>
                <p className="text-xs text-muted-foreground pl-6">
                    Checked <DateDisplay date={status.verifiedAt} format="PP p" />
                </p>
                {(status as any).actualChecksum && (
                    <div className="pl-6">
                        <p className="text-xs text-muted-foreground">Actual hash on storage:</p>
                        <p className="text-xs font-mono break-all text-red-600 dark:text-red-400">{(status as any).actualChecksum}</p>
                    </div>
                )}
            </div>
        );
    }

    if (status.status === 'no_checksum') {
        return (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Shield className="h-4 w-4" />
                <span>No checksum stored - legacy backup cannot be verified</span>
            </div>
        );
    }

    if (status.status === 'no_metadata') {
        return (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Shield className="h-4 w-4" />
                <span>No metadata file found for this backup</span>
            </div>
        );
    }

    return (
        <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
            <ShieldX className="h-4 w-4" />
            <span>Verification error: {status.status}</span>
        </div>
    );
}

export function IntegrityModal({ open, onOpenChange, file, storageConfigId, onVerifyComplete }: IntegrityModalProps) {
    const [verifying, setVerifying] = useState(false);
    const [liveResult, setLiveResult] = useState<LiveResult | null>(null);
    const router = useRouter();
    const { autoRedirectOnJobStart } = useUserPreferences();

    const hasChecksums = !!(file.checksum || file.checksumMd5);

    const handleVerify = async () => {
        setVerifying(true);
        try {
            const res = await fetch(`/api/storage/${storageConfigId}/verify-async`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ file: file.path }),
            });
            const data = await res.json();
            if (!res.ok) {
                setLiveResult({ status: 'download_error', verifiedAt: new Date().toISOString() });
                return;
            }
            if (autoRedirectOnJobStart && data.executionId) {
                onOpenChange(false);
                router.push(`/dashboard/history?executionId=${data.executionId}`);
            } else {
                toast.info("Verification started. Check History for results.");
                onVerifyComplete();
                onOpenChange(false);
            }
        } catch {
            setLiveResult({ status: 'download_error', verifiedAt: new Date().toISOString() });
        } finally {
            setVerifying(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(o) => { if (!o && !verifying) { setLiveResult(null); onOpenChange(false); } }}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Integrity Check</DialogTitle>
                    <DialogDescription className="font-mono text-xs break-all">{file.name}</DialogDescription>
                </DialogHeader>

                <div className="space-y-5 py-1">
                    {hasChecksums ? (
                        <div>
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Stored Checksums</p>
                            <div className="rounded-md border bg-muted/30 px-3 divide-y">
                                <ChecksumRow label="SHA-256" value={file.checksum} />
                                <ChecksumRow label="MD5" value={file.checksumMd5} />
                            </div>
                        </div>
                    ) : (
                        <div className="rounded-md border bg-muted/30 px-3 py-3">
                            <p className="text-xs text-muted-foreground">No checksums available. This is a legacy backup that was uploaded before checksum support was added.</p>
                        </div>
                    )}

                    <div>
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Last Verification</p>
                        <VerificationStatus verification={file.verification} liveResult={liveResult} />
                    </div>
                </div>

                <div className="flex justify-end pt-2">
                    <Button
                        onClick={handleVerify}
                        disabled={verifying || !hasChecksums}
                        className="gap-2"
                    >
                        {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                        {verifying ? "Verifying..." : "Verify Now"}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
