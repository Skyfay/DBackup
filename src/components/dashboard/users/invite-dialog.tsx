"use client";

import { useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Check, Copy, Link2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createInvitation } from "@/app/actions/tenant/invitation";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { Button } from "@/components/ui/button";
import { DIALOG_FOOTER, DIALOG_SURFACE, DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { NumberStepper } from "@/components/ui/number-stepper";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DateDisplay } from "@/components/utils/date-display";
import { COPY_FAILED, copyToClipboard } from "@/lib/clipboard";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { cn } from "@/lib/utils";
import type { UsersGroup } from "@/services/user/users-types";
import { INVITE_DAYS, INVITE_MAX_DAYS, INVITE_MIN_DAYS, INVITE_NOTE_MAX, inviteUrl } from "./invitation-model";
import { GroupPicker } from "./user-group-picker";

const log = logger.child({ component: "invite-dialog" });

/** Leaves room for the head and the foot on a short screen. */
const BODY_SCROLL = "min-h-0 flex-1 *:data-[slot=scroll-area-viewport]:max-h-[calc(95dvh-9.5rem)]";

const schema = z.object({
    groupId: z.string().min(1, "Pick the group they join with."),
    note: z.string().trim().max(INVITE_NOTE_MAX, `The note can have at most ${INVITE_NOTE_MAX} characters.`),
    days: z.number().int().min(INVITE_MIN_DAYS).max(INVITE_MAX_DAYS),
});

type Values = z.infer<typeof schema>;

const DEFAULTS: Values = { groupId: "", note: "", days: INVITE_DAYS };

/** A link that was just made, the only time its address shows. */
interface Created {
    url: string;
    expiresAt: string;
    group: string;
    note: string;
}

interface InviteDialogProps {
    open: boolean;
    groups: UsersGroup[];
    /** A platform admin gives every group, anyone else only the ones that may do no more than they may. */
    viewerPlatformAdmin: boolean;
    onOpenChange: (open: boolean) => void;
    /** Runs once a link was made, so the list of open invitations follows. */
    onCreated: () => void;
}

/**
 * Invite: a link that lets one person join with the group picked here, with the account they have
 * or a new one. The admin never types an email. After Create the dialog shows the address once,
 * since DBackup keeps only a hash of it.
 */
export function InviteDialog({ open, groups, viewerPlatformAdmin, onOpenChange, onCreated }: InviteDialogProps) {
    const [created, setCreated] = useState<Created | null>(null);
    const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: DEFAULTS });
    const saving = form.formState.isSubmitting;

    useEffect(() => {
        if (!open) return;
        form.reset(DEFAULTS);
        setCreated(null);
    }, [open, form]);

    const submit = async (values: Values) => {
        try {
            const result = await createInvitation({ groupId: values.groupId, note: values.note || undefined, days: values.days });
            if (!result.success) {
                toast.error(result.error || "The invitation could not be created.");
                return;
            }
            setCreated({
                url: inviteUrl(window.location.origin, result.data.path),
                expiresAt: result.data.expiresAt,
                group: groups.find((group) => group.id === values.groupId)?.name ?? "the group",
                note: values.note,
            });
            onCreated();
        } catch (error) {
            // Without the right to change users the action throws instead of answering.
            log.warn("Creating an invitation failed", {}, wrapError(error));
            toast.error("The invitation could not be created.");
        }
    };

    return (
        <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
            <DialogContent tone="create" showCloseButton={false} className={cn(DIALOG_SURFACE, "sm:max-w-lg")}>
                {created ? (
                    <CreatedLink created={created} onDone={() => onOpenChange(false)} />
                ) : (
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(submit)} noValidate className="flex min-h-0 flex-1 flex-col">
                            <DialogHead tone="create" icon={Link2}>
                                <DialogTitle className="text-base">Invite</DialogTitle>
                                <DialogDescription className={dialogNoteClass("create")}>A link that lets one person join with the group you pick</DialogDescription>
                            </DialogHead>

                            <ScrollArea className={BODY_SCROLL}>
                                <div className="space-y-5 p-5">
                                    <FormField
                                        control={form.control}
                                        name="groupId"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Group</FormLabel>
                                                <FormControl>
                                                    <GroupPicker
                                                        groups={groups}
                                                        viewerPlatformAdmin={viewerPlatformAdmin}
                                                        allowNone={false}
                                                        value={field.value}
                                                        onChange={field.onChange}
                                                        onBlur={field.onBlur}
                                                        ref={field.ref}
                                                    />
                                                </FormControl>
                                                <FormDescription>What they may do once they joined.</FormDescription>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    <FormField
                                        control={form.control}
                                        name="note"
                                        render={({ field }) => (
                                            <FormItem>
                                                <div className="flex items-baseline justify-between gap-2">
                                                    <FormLabel>Note</FormLabel>
                                                    <span className="text-xs text-muted-foreground">Optional</span>
                                                </div>
                                                <FormControl>
                                                    <Input placeholder="Like Jane from accounting" autoComplete="off" maxLength={INVITE_NOTE_MAX} {...field} />
                                                </FormControl>
                                                <FormDescription>Who it is for. Only the list of open invitations shows it.</FormDescription>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    <FormField
                                        control={form.control}
                                        name="days"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Works for</FormLabel>
                                                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                                                    <FormControl>
                                                        <NumberStepper
                                                            value={field.value}
                                                            onValueChange={field.onChange}
                                                            onBlur={field.onBlur}
                                                            min={INVITE_MIN_DAYS}
                                                            max={INVITE_MAX_DAYS}
                                                            decrementLabel="Fewer days"
                                                            incrementLabel="More days"
                                                        />
                                                    </FormControl>
                                                    <span className="text-sm text-muted-foreground">
                                                        {field.value === 1 ? "day" : "days"}, {INVITE_MIN_DAYS} to {INVITE_MAX_DAYS}
                                                    </span>
                                                </div>
                                                <FormDescription>The link works once. Whoever opens it first joins, then it is used up.</FormDescription>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </div>
                            </ScrollArea>

                            <div className={cn(DIALOG_FOOTER, "flex items-center justify-end gap-2")}>
                                <DialogClose asChild>
                                    <Button type="button" variant="ghost" disabled={saving}>Cancel</Button>
                                </DialogClose>
                                <Button type="submit" disabled={saving}>
                                    {saving && <Loader2 className="animate-spin" />}
                                    Create link
                                </Button>
                            </div>
                        </form>
                    </Form>
                )}
            </DialogContent>
        </Dialog>
    );
}

/** The address of a new link with Copy, when it runs out and that it works once. */
function CreatedLink({ created, onDone }: { created: Created; onDone: () => void }) {
    const [copied, setCopied] = useState(false);

    const copy = async () => {
        if (!(await copyToClipboard(created.url))) {
            toast.error(COPY_FAILED);
            return;
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <>
            <DialogHead tone="create" icon={Link2}>
                <DialogTitle className="truncate text-base">{created.note ? `Invitation for ${created.note}` : "Invitation ready"}</DialogTitle>
                <DialogDescription className={dialogNoteClass("create")}>Copy it now, DBackup shows it only this once</DialogDescription>
            </DialogHead>

            <ScrollArea className={BODY_SCROLL}>
                <div className="min-w-0 space-y-4 p-5">
                    <p className="text-sm">
                        Send it to the person it is for. Whoever opens it joins with the group <span className="font-medium">{created.group}</span>, with the account they have or a new one.
                    </p>
                    <div className="flex min-w-0 items-center gap-2 rounded-lg border bg-muted/40 p-2 pl-3">
                        <code className="min-w-0 flex-1 truncate font-mono text-sm" title={created.url}>{created.url}</code>
                        <Button type="button" variant="outline" size="sm" onClick={() => void copy()}>
                            {copied ? <Check /> : <Copy />}
                            {copied ? "Copied" : "Copy"}
                        </Button>
                    </div>
                    <ul className="space-y-1.5 text-sm text-muted-foreground">
                        <li>
                            Works once, until <DateDisplay date={created.expiresAt} format="Pp" /> (<RelativeTime date={created.expiresAt} />).
                        </li>
                        <li>DBackup keeps only a hash of it. While nobody used it, Revoke in the list of open invitations takes it back.</li>
                    </ul>
                </div>
            </ScrollArea>

            <div className={cn(DIALOG_FOOTER, "flex items-center justify-end")}>
                <Button type="button" onClick={onDone}>Done</Button>
            </div>
        </>
    );
}
