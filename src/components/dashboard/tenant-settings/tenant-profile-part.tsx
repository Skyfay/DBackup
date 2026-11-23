"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { renameOwnTenant } from "@/app/actions/tenant/tenant-settings";
import { Field, PartFrame, SaveBar, usePartSave, usePartValues, useSettingsFrame } from "@/components/dashboard/settings/settings-frame";
import { changesOf } from "@/components/dashboard/settings/settings-values";
import { countLine } from "@/components/layout/tenant-switch";
import { TenantTileMark } from "@/components/tenant/tenant-pick";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { formatBytes } from "@/lib/utils";
import type { TenantSettingsModel } from "@/services/tenant/tenant-settings-model";

const log = logger.child({ component: "tenant-profile-part" });

const FIELDS = { name: { label: "Name" } } as const;

const TYPE_NAMES: Record<string, string> = { "image/png": "PNG", "image/jpeg": "JPG", "image/gif": "GIF", "image/webp": "WebP" };

/** Sends the logo to its route, which answers like an action. */
async function sendLogo(tenantId: string, init: RequestInit): Promise<{ success: boolean; url?: string; error?: string }> {
    const response = await fetch(`/api/tenants/${encodeURIComponent(tenantId)}/logo`, init);
    const answer = (await response.json().catch(() => ({ success: false }))) as { success: boolean; error?: string; data?: { url: string } };
    return { success: answer.success, url: answer.data?.url, error: answer.error };
}

/** The logo of the tenant, uploaded or removed at once like a file, not through the save bar. */
function LogoField({ model }: { model: TenantSettingsModel }) {
    const router = useRouter();
    const { readOnly } = useSettingsFrame();
    const input = useRef<HTMLInputElement>(null);
    const [busy, setBusy] = useState(false);
    const { tenant } = model;
    const logo = tenant.logo;

    const run = async (work: () => Promise<{ success: boolean; error?: string }>, done: string, failed: string) => {
        setBusy(true);
        try {
            const result = await work();
            if (!result.success) {
                toast.error(result.error || failed);
                return;
            }
            toast.success(done);
            router.refresh();
        } catch (error) {
            log.warn("Changing the logo of the tenant failed", { tenantId: tenant.id }, wrapError(error));
            toast.error(failed);
        } finally {
            setBusy(false);
            if (input.current) input.current.value = "";
        }
    };

    const upload = (file: File) => {
        const body = new FormData();
        body.append("file", file);
        void run(() => sendLogo(tenant.id, { method: "POST", body }), "Logo saved", "The logo could not be saved.");
    };

    return (
        <div data-setting="tenant.logo" className="space-y-2 rounded-lg">
            <p className="text-sm font-medium">Logo</p>
            <div className="flex max-w-xl flex-wrap items-center gap-4 rounded-lg border border-dashed p-4">
                <TenantTileMark name={tenant.name} logo={logo?.url ?? null} className="size-14 rounded-xl text-base" />
                <div className="grid min-w-0 gap-2">
                    <p className="text-sm">
                        {logo ? (
                            <>
                                <span className="font-medium">{TYPE_NAMES[logo.mimeType] ?? "Picture"}</span>
                                <span className="text-muted-foreground"> · {formatBytes(logo.size, 0)}</span>
                            </>
                        ) : (
                            <span className="text-muted-foreground">No logo yet, the tenant shows its initials.</span>
                        )}
                    </p>
                    {!readOnly && (
                        <div className="flex flex-wrap gap-2">
                            <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()} disabled={busy}>
                                {busy ? <Loader2 className="animate-spin" /> : <ImagePlus />}
                                {logo ? "Replace" : "Upload a logo"}
                            </Button>
                            {logo && (
                                <Button type="button" variant="ghost-destructive" size="sm" disabled={busy} onClick={() => void run(() => sendLogo(tenant.id, { method: "DELETE" }), "Logo removed", "The logo could not be removed.")}>
                                    <Trash2 />
                                    Remove
                                </Button>
                            )}
                        </div>
                    )}
                </div>
                <input ref={input} type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="hidden" onChange={(event) => event.target.files?.[0] && upload(event.target.files[0])} />
            </div>
            <p className="text-xs text-muted-foreground">PNG, JPG, GIF or WebP up to 1 MB, square, at least 64 pixels.</p>
        </div>
    );
}

/** The logo tile of a preview: the logo, else the DBackup tile like the head of the sidebar. */
function HeadTile({ name, logo }: { name: string; logo: string | null }) {
    if (!logo) return <Image src="/logo.svg" alt="" width={30} height={30} className="size-7.5 shrink-0" />;
    return (
        <Avatar className="size-7.5 shrink-0 rounded-md">
            <AvatarImage src={logo} alt="" className="object-contain" />
            <AvatarFallback className="rounded-md text-[10px] font-semibold">{name.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
    );
}

/** How the name and the logo show: in the head of the sidebar of the tenant and in the tenant switcher of the platform. */
function Preview({ model, name }: { model: TenantSettingsModel; name: string }) {
    const logo = model.tenant.logo?.url ?? null;
    const shown = name.trim() || model.tenant.name;
    return (
        <div data-setting="tenant.preview" className="space-y-2">
            <p className="text-sm font-medium">How it shows</p>
            <div className="grid gap-3 rounded-xl bg-muted/40 p-4 sm:grid-cols-2">
                <div className="min-w-0 space-y-1.5">
                    <p className="text-xs text-muted-foreground">The head of the sidebar</p>
                    <div className="flex min-w-0 items-center gap-2.5 rounded-lg border bg-sidebar px-3 py-2.5">
                        <HeadTile name={shown} logo={logo} />
                        <span className="grid min-w-0 leading-tight">
                            <span className="truncate text-sm font-semibold">{shown}</span>
                            <span className="truncate text-xs text-muted-foreground">Your backups</span>
                        </span>
                    </div>
                </div>
                <div className="min-w-0 space-y-1.5">
                    <p className="text-xs text-muted-foreground">The tenant switcher of the platform</p>
                    <div className="flex min-w-0 items-center gap-2.5 rounded-lg border bg-raised px-3 py-2.5">
                        <TenantTileMark name={shown} logo={logo} className="size-6.5 rounded-md text-[10.5px]" />
                        <span className="grid min-w-0 leading-tight">
                            <span className="truncate text-[13.5px]">{shown}</span>
                            <span className="truncate text-xs text-muted-foreground">{countLine(model.tenant)}</span>
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
}

/** The name and the logo of the open tenant, and how they show. */
export function TenantProfilePart({ model }: { model: TenantSettingsModel }) {
    const { readOnly } = useSettingsFrame();
    const form = usePartValues("profile", { name: model.tenant.name });
    const save = usePartSave("profile");
    const { values, set } = form;

    return (
        <>
            <PartFrame part="profile">
                <Field
                    label="Name"
                    setting="tenant.name"
                    hint="In the head of the sidebar, in the tenant switcher and on the Tenants page of the platform."
                    error={save.errorOf("name")}
                >
                    {(id) => <Input id={id} value={values.name} maxLength={60} className="max-w-md" disabled={readOnly} onChange={(event) => set("name", event.target.value)} />}
                </Field>
                <LogoField model={model} />
                <Preview model={model} name={values.name} />
            </PartFrame>
            <SaveBar
                changes={changesOf(form.base, values, FIELDS)}
                saving={save.saving}
                onDiscard={() => {
                    form.discard();
                    save.clearProblem();
                }}
                onSave={() => save.run(() => renameOwnTenant(model.tenant.id, values.name), () => form.commit())}
            />
        </>
    );
}
