"use client";

import { useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { Loader2, Pencil, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { createUser, updateUser, updateUserGroup } from "@/app/actions/auth/user";
import { PasswordChecklist } from "@/components/auth/password-checklist";
import { Button } from "@/components/ui/button";
import { DIALOG_FOOTER, DIALOG_SURFACE, DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MAX_PASSWORD_LENGTH, passwordProblem, type PasswordRules } from "@/lib/auth/password-policy";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { cn } from "@/lib/utils";
import type { UserRow, UsersGroup } from "@/services/user/users-types";
import { NO_GROUP } from "./user-columns";
import { GroupPicker } from "./user-group-picker";
import { PasswordField } from "./user-password-field";

const log = logger.child({ component: "user-dialog" });

/** Leaves room for the head and the foot on a short screen. */
const BODY_SCROLL = "min-h-0 flex-1 *:data-[slot=scroll-area-viewport]:max-h-[calc(95dvh-9.5rem)]";

/** The fields of the dialog. A new password follows the rules of Settings > Passwords once they are loaded. */
function schemaFor(creating: boolean, rules: PasswordRules | null) {
    return z
        .object({
            name: z.string().trim().min(2, "Name must be at least 2 characters.").max(100, "Name can have at most 100 characters."),
            email: z.string().trim().email("Invalid email address."),
            password: creating
                ? z.string().min(1, "Enter a password, or click Generate.").max(MAX_PASSWORD_LENGTH, `The password can have at most ${MAX_PASSWORD_LENGTH} characters.`)
                : z.string(),
            groupId: z.string().min(1, "Pick a group, or No group."),
        })
        .superRefine((values, ctx) => {
            const problem = creating && rules && values.password ? passwordProblem(values.password, rules, values) : null;
            if (problem) ctx.addIssue({ code: "custom", path: ["password"], message: problem });
        });
}

type Values = z.infer<ReturnType<typeof schemaFor>>;

interface UserDialogProps {
    open: boolean;
    /** The user to edit, null for a new one. Stays set while the dialog closes. */
    user: UserRow | null;
    groups: UsersGroup[];
    /** The rules of a new password, null while they load. */
    passwordRules: PasswordRules | null;
    viewerSuperAdmin: boolean;
    onOpenChange: (open: boolean) => void;
    onSaved: () => void;
}

/** New user and Edit user: the name, the email, a first password for a new one and the group. */
export function UserDialog({ open, user, groups, passwordRules, viewerSuperAdmin, onOpenChange, onSaved }: UserDialogProps) {
    const creating = user === null;
    const tone = creating ? "create" : "edit";
    const currentGroup = user ? user.group?.id ?? NO_GROUP : "";
    const form = useForm<Values>({
        resolver: zodResolver(schemaFor(creating, passwordRules)),
        defaultValues: { name: "", email: "", password: "", groupId: "" },
    });
    const [name, email, password] = useWatch({ control: form.control, name: ["name", "email", "password"] });

    useEffect(() => {
        if (open) form.reset({ name: user?.name ?? "", email: user?.email ?? "", password: "", groupId: currentGroup });
    }, [open, user, currentGroup, form]);

    // Nobody changes their own group, and only a SuperAdmin moves a SuperAdmin.
    const groupLocked = user ? (user.isYou ? "Another admin changes your own group." : user.superAdmin && !viewerSuperAdmin ? "Only a SuperAdmin can change the group of a SuperAdmin." : null) : null;
    const saving = form.formState.isSubmitting;

    const submit = async (values: Values) => {
        try {
            if (!user) {
                const result = await createUser({
                    name: values.name,
                    email: values.email,
                    password: values.password,
                    groupId: values.groupId === NO_GROUP ? null : values.groupId,
                });
                if (!result.success) {
                    toast.error(result.error || "The user could not be created.");
                    return;
                }
                toast.success(`${values.name} can sign in now`);
            } else {
                if (values.name !== user.name || values.email !== user.email) {
                    const result = await updateUser(user.id, { name: values.name, email: values.email });
                    if (!result.success) {
                        toast.error(result.error || "The user could not be saved.");
                        return;
                    }
                }
                if (values.groupId !== currentGroup) {
                    const result = await updateUserGroup(user.id, values.groupId);
                    if (!result.success) {
                        toast.error(result.error || "The group could not be changed.");
                        return;
                    }
                }
                toast.success("User saved");
            }
            onSaved();
            onOpenChange(false);
        } catch (error) {
            // Without the right to change users the actions throw instead of answering.
            log.warn("Saving a user failed", { userId: user?.id }, wrapError(error));
            toast.error("The user could not be saved.");
        }
    };

    return (
        <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
            <DialogContent tone={tone} showCloseButton={false} className={cn(DIALOG_SURFACE, "sm:max-w-2xl")}>
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(submit)} noValidate className="flex min-h-0 flex-1 flex-col">
                        <DialogHead tone={tone} icon={creating ? UserPlus : Pencil}>
                            <DialogTitle className="truncate text-base">{creating ? "New user" : `Edit ${user.name}`}</DialogTitle>
                            <DialogDescription className={dialogNoteClass(tone)}>
                                {creating ? "Signs in right away with the password, with the access of the group" : "The name, the email and the group"}
                            </DialogDescription>
                        </DialogHead>

                        <ScrollArea className={BODY_SCROLL}>
                            <div className="space-y-5 p-5">
                                <div className="grid gap-4 sm:grid-cols-2">
                                    <FormField
                                        control={form.control}
                                        name="name"
                                        render={({ field }) => (
                                            <FormItem className="min-w-0">
                                                <FormLabel>Name</FormLabel>
                                                <FormControl>
                                                    <Input placeholder="Jane Doe" autoComplete="off" {...field} />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={form.control}
                                        name="email"
                                        render={({ field }) => (
                                            <FormItem className="min-w-0">
                                                <FormLabel>Email</FormLabel>
                                                <FormControl>
                                                    <Input type="email" placeholder="jane@example.com" autoComplete="off" {...field} />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </div>

                                {creating && (
                                    <FormField
                                        control={form.control}
                                        name="password"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Password</FormLabel>
                                                <FormControl>
                                                    <PasswordField
                                                        value={field.value}
                                                        onChange={field.onChange}
                                                        onBlur={field.onBlur}
                                                        name={field.name}
                                                        ref={field.ref}
                                                        rules={passwordRules}
                                                        owner={{ name, email }}
                                                    />
                                                </FormControl>
                                                {passwordRules && <PasswordChecklist rules={passwordRules} password={password} owner={{ name, email }} className="py-0.5" />}
                                                <FormDescription>Hand it to them. They change it under Profile after the first sign-in.</FormDescription>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                )}

                                <FormField
                                    control={form.control}
                                    name="groupId"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Group</FormLabel>
                                            <FormControl>
                                                <GroupPicker
                                                    groups={groups}
                                                    viewerSuperAdmin={viewerSuperAdmin}
                                                    value={field.value}
                                                    onChange={field.onChange}
                                                    disabled={groupLocked !== null}
                                                    onBlur={field.onBlur}
                                                    ref={field.ref}
                                                />
                                            </FormControl>
                                            {groupLocked ? (
                                                <FormDescription>{groupLocked}</FormDescription>
                                            ) : (
                                                !viewerSuperAdmin && groups.some((group) => group.superAdmin) && (
                                                    <FormDescription>Only a SuperAdmin can make someone a SuperAdmin.</FormDescription>
                                                )
                                            )}
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
                                {creating ? "Create user" : "Save changes"}
                            </Button>
                        </div>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
}
