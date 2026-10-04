"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Lock, LockOpen, RefreshCw, Upload } from "lucide-react";
import { toast } from "sonner";
import { regenerateCertificate, uploadCertificate } from "@/app/actions/settings/certificate";
import { DateDisplay } from "@/components/utils/date-display";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, DIALOG_FOOTER, DIALOG_SURFACE, DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { cn } from "@/lib/utils";
import type { CertificateInfo } from "@/services/system/settings-types";
import { PartFrame, useSettingsFrame } from "./settings-frame";
import { CERTIFICATE_WARN_DAYS } from "./settings-states";

const log = logger.child({ component: "https-part" });

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
            <dt className="shrink-0 text-sm text-muted-foreground">{label}</dt>
            <dd className="min-w-0 text-sm font-medium break-words sm:text-right">{children}</dd>
        </div>
    );
}

/** "Runs out in 12 days", "Runs out today" or "Expired". */
function leftText(certificate: CertificateInfo): string {
    if (certificate.expired) return "Expired";
    if (certificate.daysRemaining < 1) return "Runs out today";
    return certificate.daysRemaining === 1 ? "Runs out tomorrow" : `Runs out in ${certificate.daysRemaining} days`;
}

function Status({ certificate }: { certificate: CertificateInfo | null }) {
    const unreadable = !certificate || certificate.error;
    const off = certificate && !certificate.isHttpsEnabled;
    const soon = certificate && !certificate.expired && certificate.daysRemaining <= CERTIFICATE_WARN_DAYS;
    const tone = unreadable || soon ? "warning" : certificate?.expired ? "destructive" : off ? "neutral" : "success";
    const Icon = off ? LockOpen : Lock;
    return (
        <div className="flex items-start gap-3">
            <span
                className={cn(
                    "flex size-10 shrink-0 items-center justify-center rounded-lg",
                    tone === "success" && "bg-success/12 text-success",
                    tone === "warning" && "bg-warning/12 text-warning",
                    tone === "destructive" && "bg-destructive/12 text-destructive",
                    tone === "neutral" && "bg-muted text-muted-foreground"
                )}
                aria-hidden="true"
            >
                <Icon className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{unreadable ? "The certificate could not be read" : off ? "HTTPS is off" : "HTTPS is on"}</p>
                    {certificate?.exists && !unreadable && (
                        <>
                            <Badge variant="outline">{certificate.isSelfSigned ? "Self-signed" : "Your own"}</Badge>
                            {(certificate.expired || soon) && (
                                <Badge variant="outline" className={certificate.expired ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-warning/30 bg-warning/10 text-warning"}>
                                    {leftText(certificate)}
                                </Badge>
                            )}
                        </>
                    )}
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">
                    {unreadable
                        ? certificate?.error ?? "openssl could not read the files in /data/certs. HTTPS may still work, a restart shows whether it does."
                        : off
                            ? "DISABLE_HTTPS on the container turns it off. A proxy in front of DBackup may still encrypt the way there."
                            : !certificate.exists
                                ? "No certificate yet. DBackup makes a self-signed one when it starts, or upload your own."
                                : certificate.isSelfSigned
                                    ? "Every connection to DBackup is encrypted. Browsers warn once, since nobody they know signed it."
                                    : "Every connection to DBackup is encrypted with your own certificate."}
                </p>
            </div>
        </div>
    );
}

/** The certificate DBackup answers with: its state, what it says about itself, and a new one. */
export function HttpsPart({ certificate }: { certificate: CertificateInfo | null }) {
    const router = useRouter();
    const { readOnly } = useSettingsFrame();
    const [uploading, setUploading] = useState(false);
    const [regenerating, setRegenerating] = useState(false);
    const [pending, setPending] = useState(false);
    const certFile = useRef<HTMLInputElement>(null);
    const keyFile = useRef<HTMLInputElement>(null);
    const readable = certificate?.exists && !certificate.error;
    const soon = readable && !certificate.expired && certificate.daysRemaining <= CERTIFICATE_WARN_DAYS;

    const upload = async (event: React.FormEvent) => {
        event.preventDefault();
        const cert = certFile.current?.files?.[0];
        const key = keyFile.current?.files?.[0];
        if (!cert || !key) return toast.error("Pick the certificate and its private key.");
        const formData = new FormData();
        formData.append("certificate", cert);
        formData.append("privateKey", key);
        setPending(true);
        // An action that fails on the way, like on a lost connection, throws instead of answering,
        // and the dialog, which stays open while pending, must not wait for it forever.
        try {
            const result = await uploadCertificate(formData);
            if (!result.success) return toast.error(result.error || "The certificate could not be uploaded.");
            toast.success("The certificate is uploaded. It applies after a restart of DBackup.");
            setUploading(false);
            router.refresh();
        } catch (error: unknown) {
            log.warn("Uploading a certificate failed", {}, wrapError(error));
            toast.error("The certificate could not be uploaded.");
        } finally {
            setPending(false);
        }
    };

    const regenerate = async () => {
        setPending(true);
        try {
            const result = await regenerateCertificate();
            if (!result.success) return toast.error(result.error || "No new certificate could be made.");
            toast.success("A new self-signed certificate is ready. It applies after a restart of DBackup.");
            setRegenerating(false);
            router.refresh();
        } catch (error: unknown) {
            log.warn("Making a self-signed certificate failed", {}, wrapError(error));
            toast.error("No new certificate could be made.");
        } finally {
            setPending(false);
        }
    };

    return (
        <PartFrame part="https">
            <Status certificate={certificate} />

            {(soon || (readable && certificate.expired)) && (
                <div className={cn("flex items-start gap-3 rounded-lg border px-4 py-3", certificate.expired ? "border-destructive/30 bg-destructive/5" : "border-warning/30 bg-warning/5")}>
                    <AlertTriangle className={cn("mt-0.5 size-4 shrink-0", certificate.expired ? "text-destructive" : "text-warning")} aria-hidden="true" />
                    <div className="min-w-0">
                        <p className="text-sm font-medium">{leftText(certificate)}</p>
                        <p className="text-xs text-muted-foreground">
                            Upload your own certificate, or make a new self-signed one. DBackup renews an expired self-signed one when it starts.
                        </p>
                    </div>
                </div>
            )}

            {readable && (
                <dl data-setting="https.certificate" className="divide-y border-y">
                    <Fact label="Issued to">{certificate.subject}</Fact>
                    <Fact label="Issued by">{certificate.issuer}</Fact>
                    <Fact label="Valid">
                        {certificate.expiresAt ? (
                            <>until <DateDisplay date={certificate.expiresAt} format="PP" /></>
                        ) : (
                            certificate.validTo || "Unknown"
                        )}
                    </Fact>
                    <Fact label="SHA-256"><span className="font-mono text-xs break-all">{certificate.fingerprint || "Unknown"}</span></Fact>
                    {certificate.names.length > 0 && <Fact label="Names">{certificate.names.join(", ")}</Fact>}
                </dl>
            )}

            {!readOnly && (
                <div className="space-y-2">
                    <div className="flex flex-wrap gap-2">
                        <Button variant="outline" size="sm" onClick={() => setUploading(true)} data-setting="https.upload">
                            <Upload />
                            Upload certificate
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => setRegenerating(true)} data-setting="https.self-signed">
                            <RefreshCw />
                            Make a new self-signed one
                        </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">It lies in /data/certs. A new certificate applies after a restart of DBackup.</p>
                </div>
            )}

            <Dialog open={uploading} onOpenChange={(open) => !pending && setUploading(open)}>
                <DialogContent tone="warning" showCloseButton={false} className={cn(DIALOG_SURFACE, "sm:max-w-lg")}>
                    <form onSubmit={(event) => void upload(event)}>
                        <DialogHead tone="warning" icon={Upload}>
                            <DialogTitle className="text-base">Upload certificate</DialogTitle>
                            <DialogDescription className={dialogNoteClass("warning")}>Replaces the certificate at the next restart</DialogDescription>
                        </DialogHead>
                        <div className="space-y-4 p-5">
                            <div className="space-y-2">
                                <Label htmlFor="tls-certificate">Certificate</Label>
                                <Input id="tls-certificate" ref={certFile} type="file" accept=".crt,.pem,.cer" required />
                                <p className="text-xs text-muted-foreground">PEM, like tls.crt. With the chain of its issuer after it, if it has one.</p>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="tls-key">Private key</Label>
                                <Input id="tls-key" ref={keyFile} type="file" accept=".key,.pem" required />
                                <p className="text-xs text-muted-foreground">PEM, RSA, EC or Ed25519. It must belong to the certificate, which is checked before anything is replaced.</p>
                            </div>
                        </div>
                        <div className={cn(DIALOG_FOOTER, "flex justify-end gap-2")}>
                            <Button type="button" variant="outline" onClick={() => setUploading(false)} disabled={pending}>
                                Cancel
                            </Button>
                            <Button type="submit" disabled={pending}>
                                {pending ? <Loader2 className="animate-spin" /> : <Upload />}
                                Upload
                            </Button>
                        </div>
                    </form>
                </DialogContent>
            </Dialog>

            <ConfirmDialog
                open={regenerating}
                onOpenChange={setRegenerating}
                title="Make a new self-signed certificate?"
                note={readable && !certificate.isSelfSigned ? "Your own certificate goes" : "Valid for a year"}
                description="It replaces the certificate in /data/certs and applies after a restart of DBackup. Browsers warn once more, since nobody they know signed it."
                icon={RefreshCw}
                tone="warning"
                confirmLabel="Make a new one"
                isPending={pending}
                onConfirm={() => void regenerate()}
            />
        </PartFrame>
    );
}
