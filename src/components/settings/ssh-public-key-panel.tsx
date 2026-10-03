"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Copy, Download } from "lucide-react";
import { toast } from "sonner";
import { COPY_FAILED, copyToClipboard } from "@/lib/clipboard";

/**
 * The public half of an SSH key, ready to install on a host.
 *
 * Shown after DBackup generates a keypair and again from the profile list, since the public
 * key is the one part of an SSH credential that is not a secret.
 */
export function SshPublicKeyPanel({
    publicKey,
    fingerprint,
    fileName,
}: {
    publicKey: string;
    fingerprint?: string;
    /** Base name for the `.pub` download, usually the profile name. */
    fileName?: string;
}) {
    const copy = () => {
        void copyToClipboard(publicKey).then((copied) => (copied ? toast.success("Public key copied") : toast.error(COPY_FAILED)));
    };

    const download = () => {
        const slug = (fileName ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        const url = URL.createObjectURL(new Blob([`${publicKey}\n`], { type: "text/plain" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = `${slug || "dbackup-key"}.pub`;
        link.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
                <Label className="text-xs">Public key</Label>
                <div className="flex gap-1">
                    <Button type="button" variant="outline" size="sm" onClick={copy}>
                        <Copy className="mr-2 h-3.5 w-3.5" />
                        Copy
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={download}>
                        <Download className="mr-2 h-3.5 w-3.5" />
                        .pub
                    </Button>
                </div>
            </div>
            <pre className="rounded border bg-muted p-2 font-mono text-xs whitespace-pre-wrap break-all">
                {publicKey}
            </pre>
            <p className="text-xs text-muted-foreground">
                Add this line to <code className="font-mono">~/.ssh/authorized_keys</code> on the
                target host.
                {fingerprint && (
                    <>
                        {" "}
                        Fingerprint <span className="font-mono">{fingerprint}</span>.
                    </>
                )}
            </p>
        </div>
    );
}
