"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Camera, Check, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { saveProfileAccountAction } from "@/app/actions/auth/profile";
import { Field, PartFrame, SaveBar, usePartSave, usePartValues } from "@/components/dashboard/settings/settings-frame";
import { changesOf } from "@/components/dashboard/settings/settings-values";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth/client";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import type { ProfileModel } from "@/services/user/profile-model";

const log = logger.child({ component: "account-part" });

const FIELDS = { name: { label: "Name" }, email: { label: "Email" } } as const;

/** "MF" for Manu Fay, the first two letters of a single name. */
export function initialsOf(name: string): string {
    const words = name.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return "?";
    return (words.length === 1 ? words[0].slice(0, 2) : `${words[0][0]}${words[words.length - 1][0]}`).toUpperCase();
}

/** Sends the picture to the route of the own picture, which answers like an action. */
async function sendPicture(init: RequestInit): Promise<{ success: boolean; url?: string; error?: string }> {
    const response = await fetch("/api/user/avatar", init);
    const answer = (await response.json().catch(() => ({ success: false }))) as { success: boolean; error?: string; data?: { url: string } };
    return { success: answer.success, url: answer.data?.url, error: answer.error };
}

/** The picture of the viewer, uploaded or removed at once like a file, not through the save bar. */
function PictureField({ name, image }: { name: string; image: string | null }) {
    const router = useRouter();
    const { refetch } = authClient.useSession();
    const input = useRef<HTMLInputElement>(null);
    const [picture, setPicture] = useState(image);
    const [busy, setBusy] = useState(false);

    const run = async (work: () => Promise<{ success: boolean; url?: string; error?: string }>, done: (url?: string) => void, failed: string) => {
        setBusy(true);
        try {
            const result = await work();
            if (!result.success) {
                toast.error(result.error || failed);
                return;
            }
            done(result.url);
            await refetch();
            router.refresh();
        } catch (error) {
            log.warn("Changing the picture failed", {}, wrapError(error));
            toast.error(failed);
        } finally {
            setBusy(false);
            if (input.current) input.current.value = "";
        }
    };

    const upload = (file: File) => {
        const body = new FormData();
        body.append("file", file);
        void run(() => sendPicture({ method: "POST", body }), (url) => {
            setPicture(url ?? null);
            toast.success("Picture saved");
        }, "The picture could not be saved.");
    };

    return (
        <div data-setting="profile.picture" className="flex items-center gap-4 rounded-lg">
            <Avatar className="size-16">
                <AvatarImage src={picture ?? undefined} alt={name} className="object-cover" />
                <AvatarFallback className="bg-muted text-lg font-semibold">{initialsOf(name)}</AvatarFallback>
            </Avatar>
            <div className="grid gap-1.5">
                <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()} disabled={busy}>
                        {busy ? <Loader2 className="animate-spin" /> : <Camera />}
                        Upload a picture
                    </Button>
                    {picture && (
                        <Button type="button" variant="ghost-destructive" size="sm" disabled={busy} onClick={() => void run(() => sendPicture({ method: "DELETE" }), () => {
                            setPicture(null);
                            toast.success("Picture removed");
                        }, "The picture could not be removed.")}>
                            <Trash2 />
                            Remove
                        </Button>
                    )}
                </div>
                <p className="text-xs text-muted-foreground">PNG, JPG, GIF or WebP up to 5 MB, shown in the sidebar and beside your name.</p>
                <input ref={input} type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="hidden" onChange={(event) => event.target.files?.[0] && upload(event.target.files[0])} />
            </div>
        </div>
    );
}

/** What the group of the viewer lets them do, in the sentences of the Users page. */
function AccessBox({ model }: { model: ProfileModel }) {
    return (
        <div data-setting="profile.access" className="rounded-lg border p-4">
            <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold">Your access</span>
                {model.group ? (
                    <span className="rounded-md border px-2 py-0.5 text-xs font-medium">{model.group.name}</span>
                ) : (
                    <span className="rounded-md border border-dashed border-warning/60 px-2 py-0.5 text-xs font-medium text-warning">No group</span>
                )}
                {model.can.seeGroups && model.group && (
                    <Link href="/dashboard/users?tab=groups" className="ml-auto inline-flex items-center gap-1 rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground hover:underline hover:underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring/50">
                        Your group
                        <ArrowUpRight className="size-3" aria-hidden="true" />
                    </Link>
                )}
            </div>
            <ul className="mt-2.5 grid gap-1.5">
                {model.access.map((sentence) => (
                    <li key={sentence} className="flex gap-2 text-sm">
                        <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                        {sentence}
                    </li>
                ))}
            </ul>
        </div>
    );
}

/** The picture, the name and the email of the viewer, and what their group lets them do. */
export function AccountPart({ model }: { model: ProfileModel }) {
    const { user, can } = model;
    const { refetch } = authClient.useSession();
    const form = usePartValues("account", { name: user.name, email: user.email });
    const save = usePartSave("account");
    const { values, set } = form;

    return (
        <>
            <PartFrame part="account">
                <PictureField name={user.name} image={user.image} />
                <Field
                    label="Name"
                    setting="profile.name"
                    hint={can.updateName ? "Shown in the audit log, in Recently deleted and as who started a run." : "Your group may not change your name."}
                    error={save.errorOf("name")}
                >
                    {(id) => <Input id={id} value={values.name} maxLength={100} className="max-w-md" disabled={!can.updateName} onChange={(event) => set("name", event.target.value)} />}
                </Field>
                <Field label="Email" setting="profile.email" hint={can.updateEmail ? "You sign in with it." : "Your group may not change your email."} error={save.errorOf("email")}>
                    {(id) => <Input id={id} type="email" value={values.email} className="max-w-md" disabled={!can.updateEmail} onChange={(event) => set("email", event.target.value)} />}
                </Field>
                <AccessBox model={model} />
            </PartFrame>
            <SaveBar
                changes={changesOf(form.base, values, FIELDS)}
                saving={save.saving}
                onDiscard={() => {
                    form.discard();
                    save.clearProblem();
                }}
                onSave={() => save.run(() => saveProfileAccountAction(values), () => {
                    form.commit();
                    // The sidebar names the viewer from the session.
                    void refetch();
                })}
            />
        </>
    );
}
