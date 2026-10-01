"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImageIcon, Loader2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { ChoiceCards } from "@/components/adapter/connection-mode-choice";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Label } from "@/components/ui/label";
import { cn, formatBytes } from "@/lib/utils";
import type { LoginImageInfo, LoginLook } from "@/services/system/login-image-service";

const ACCEPT = "image/png,image/jpeg,image/webp";
const PREVIEW_LOGOS = ["postgres", "mongodb", "mariadb", "redis", "google-drive", "dropbox"];

/** The login page small: what its left side shows, and the form as lines beside it. */
function MiniLogin({ children }: { children: React.ReactNode }) {
    return (
        <span className="flex h-24 w-full overflow-hidden rounded-md border bg-page" aria-hidden="true">
            <span className="relative w-[46%] shrink-0 overflow-hidden border-r">{children}</span>
            <span className="flex flex-1 flex-col justify-center gap-1.5 px-3">
                <span className="h-1.5 w-2/5 rounded-full bg-foreground/70" />
                <span className="h-1.5 w-4/5 rounded-full bg-muted" />
                <span className="h-1.5 w-4/5 rounded-full bg-muted" />
                <span className="h-1.5 w-4/5 rounded-full bg-foreground/70" />
            </span>
        </span>
    );
}

function LogosPreview() {
    const row = (offset: string) => (
        <span className={cn("flex gap-1", offset)}>
            {PREVIEW_LOGOS.map((id) => (
                <span key={id} className="flex size-4.5 shrink-0 items-center justify-center rounded-[4px] border bg-background/70">
                    <AdapterIcon adapterId={id} className="size-2.5" />
                </span>
            ))}
        </span>
    );
    return (
        <MiniLogin>
            <span className="login-tint flex size-full flex-col justify-center gap-1 bg-card px-2">
                {row("")}
                {row("ml-2.5")}
            </span>
        </MiniLogin>
    );
}

function ImagePreview({ src }: { src: string | null }) {
    return (
        <MiniLogin>
            {src ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={src} alt="" className="size-full object-cover" />
            ) : (
                <span className="flex size-full items-center justify-center bg-muted/60">
                    <ImageIcon className="size-5 text-muted-foreground" />
                </span>
            )}
        </MiniLogin>
    );
}

interface LoginLookFieldProps {
    value: LoginLook;
    onChange: (look: LoginLook) => void;
    image: LoginImageInfo | null;
    readOnly: boolean;
    error?: string;
}

/**
 * What the left of the login page shows, under Settings, Sign-in: the logos of every adapter or a
 * picture of the instance. The choice waits for Save like the rest of the part. A picture is kept
 * the moment it is dropped, since the login page shows it only once Your own image is saved.
 */
export function LoginLookField({ value, onChange, image, readOnly, error }: LoginLookFieldProps) {
    const router = useRouter();
    const input = useRef<HTMLInputElement>(null);
    const [busy, setBusy] = useState(false);
    const [dragging, setDragging] = useState(false);
    const [removing, setRemoving] = useState(false);
    const [size, setSize] = useState<string | null>(null);
    const src = image ? `/api/settings/login-image?v=${new Date(image.updatedAt).getTime()}` : null;

    const upload = async (file: File | undefined) => {
        if (!file || readOnly) return;
        setBusy(true);
        try {
            const body = new FormData();
            body.set("file", file);
            const response = await fetch("/api/settings/login-image", { method: "POST", body });
            const answer = (await response.json().catch(() => ({ success: false }))) as { success: boolean; error?: string };
            if (!answer.success) {
                toast.error(answer.error ?? "The picture could not be saved.");
                return;
            }
            toast.success("Picture saved. Save the part to show it on the login page.");
            onChange("image");
            router.refresh();
        } catch {
            toast.error("The picture could not be saved.");
        } finally {
            setBusy(false);
        }
    };

    const remove = async () => {
        setBusy(true);
        try {
            const response = await fetch("/api/settings/login-image", { method: "DELETE" });
            if (!response.ok) {
                toast.error("The picture could not be removed.");
                return;
            }
            setRemoving(false);
            onChange("logos");
            router.refresh();
        } catch {
            toast.error("The picture could not be removed.");
        } finally {
            setBusy(false);
        }
    };

    return (
        <div data-setting="signin.look" className="min-w-0 space-y-3">
            <Label>Login page</Label>
            <ChoiceCards
                value={value}
                onValueChange={(next) => onChange(next === "image" ? "image" : "logos")}
                disabled={readOnly}
                options={[
                    { value: "logos", title: "DBackup logos", description: "Every adapter, in rows that drift. New ones join by themselves.", preview: <LogosPreview /> },
                    { value: "image", title: "Your own image", description: "A picture of yours behind the name, darkened at the foot so the text stays readable.", preview: <ImagePreview src={src} /> },
                ]}
            />

            {image ? (
                <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed px-3 py-2.5">
                    <ImageIcon className="size-4.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium" title={image.fileName}>{image.fileName}</p>
                        <p className="text-xs text-muted-foreground">{[size, formatBytes(image.size, 1)].filter(Boolean).join(", ")}</p>
                    </div>
                    {src && (
                        // Reads the size of the picture for the line above, without showing it twice.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={src} alt="" className="hidden" onLoad={(event) => setSize(`${event.currentTarget.naturalWidth} × ${event.currentTarget.naturalHeight}`)} />
                    )}
                    {!readOnly && (
                        <>
                            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}>
                                {busy ? <Loader2 className="animate-spin" /> : <Upload />}
                                Replace
                            </Button>
                            <Button type="button" variant="ghost" size="sm" tone="destructive" disabled={busy} onClick={() => setRemoving(true)}>
                                <Trash2 />
                                Remove
                            </Button>
                        </>
                    )}
                </div>
            ) : (
                !readOnly && (
                    <button
                        type="button"
                        onClick={() => input.current?.click()}
                        onDragOver={(event) => {
                            event.preventDefault();
                            setDragging(true);
                        }}
                        onDragLeave={() => setDragging(false)}
                        onDrop={(event) => {
                            event.preventDefault();
                            setDragging(false);
                            void upload(event.dataTransfer.files[0]);
                        }}
                        disabled={busy}
                        className={cn(
                            "flex w-full items-center gap-3 rounded-lg border border-dashed p-3 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50",
                            dragging && "border-foreground/40 bg-muted/50"
                        )}
                    >
                        {busy ? <Loader2 className="size-5 shrink-0 animate-spin text-muted-foreground" /> : <Upload className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />}
                        <span className="min-w-0">
                            <span className="block text-sm font-medium">Drop a picture here, or pick one</span>
                            <span className="block text-xs text-muted-foreground">It shows once Your own image is saved.</span>
                        </span>
                    </button>
                )
            )}
            <input
                ref={input}
                type="file"
                accept={ACCEPT}
                className="hidden"
                onChange={(event) => {
                    void upload(event.target.files?.[0]);
                    event.target.value = "";
                }}
            />
            {error ? (
                <p className="text-xs text-destructive">{error}</p>
            ) : (
                <p className="text-xs text-muted-foreground">
                    PNG, JPG or WebP up to 5 MB, at least 1600 px wide. Everyone who opens the login page sees it, so nothing private. It is part of the configuration backup.
                </p>
            )}

            <ConfirmDialog
                open={removing}
                onOpenChange={setRemoving}
                title="Remove the picture?"
                description="The login page shows the logos of DBackup again."
                confirmLabel="Remove"
                destructive
                isPending={busy}
                onConfirm={() => void remove()}
            />
        </div>
    );
}
