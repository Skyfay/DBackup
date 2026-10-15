"use client";

import { useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { Loader2, Pencil, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { createUser, updateUser, updateUserGroup } from "@/app/actions/auth/user";
import { PasswordChecklist } from "@/components/auth/password-checklist";
import { useViewerPermissions } from "@/components/permissions/permissions-context";
import { useTenantView } from "@/components/tenant/tenant-view";
import { Button } from "@/components/ui/button";
import { DIALOG_FOOTER, DIALOG_SURFACE, DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MAX_PASSWORD_LENGTH, passwordProblem, type PasswordRules } from "@/lib/auth/password-policy";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { cn } from "@/lib/utils";
import type { UserRow, UsersGroup } from "@/services/user/users-types";
import { accountLock, groupLock, groupsOfTenant } from "./user-access";
import { NO_GROUP } from "./user-columns";
import { GroupPicker } from "./user-group-picker";
import { PasswordField } from "./user-password-field";
import { TenantField } from "./user-tenant-field";

const log = logger.child({ component: "user-dialog" });

/** Leaves room for the head and the foot on a short screen. */
const BODY_SCROLL = "min-h-0 flex-1 *:data-[slot=scroll-area-viewport]:max-h-[calc(95dvh-9.5rem)]";

/**
 * The fields of the dialog. A new password follows the rules of Settings > Passwords once they are
 * loaded. A new account of All tenants names its tenant, and outside the home tenant its group.
 */
function schemaFor(creating: boolean, rules: PasswordRules | null, pickTenant: boolean) {
    return z
        .object({
            name: z.string().trim().min(2, "Name must be at least 2 characters.").max(100, "Name can have at most 100 characters."),
            email: z.string().trim().email("Invalid email address."),
            password: creating
                ? z.string().min(1, "Enter a password, or click Generate.").max(MAX_PASSWORD_LENGTH, `The password can have at most ${MAX_PASSWORD_LENGTH} characters.`)
                : z.string(),
            tenantId: pickTenant ? z.string().min(1, "Pick the tenant they work in.") : z.string(),
            groupId: z.string().min(1, "Pick a group, or No group."),
        })
        .superRefine((values, ctx) => {
            const problem = creating && rules && values.password ? passwordProblem(values.password, rules, values) : null;
            if (problem) ctx.addIssue({ code: "custom", path: ["password"], message: problem });
            if (pickTenant && values.tenantId && values.tenantId !== HOME_TENANT_ID && values.groupId === NO_GROUP) {
                ctx.addIssue({ code: "custom", path: ["groupId"], message: "Pick the group they work with in this tenant." });
            }
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
    /** A platform admin changes every account and gives every group. */
    viewerPlatformAdmin: boolean;
    /** A new account may start without a group, only in the home tenant. */
    allowNoGroup: boolean;
    /**
     * All tenants, where an account has a group per tenant. New user picks the tenant with the
     * group, and Edit changes the name and the email alone, the panel the groups.
     */
    allTenants?: boolean;
    onOpenChange: (open: boolean) => void;
    onSaved: () => void;
}

/**
 * New user and Edit user: the name, the email, a first password for a new one and the group. The
 * name and the email of an account the viewer may not change stay as they are, the group can
 * still change.
 */
export function UserDialog({ open, user, groups, passwordRules, viewerPlatformAdmin, allowNoGroup, allTenants = false, onOpenChange, onSaved }: UserDialogProps) {
    const creating = user === null;
    const tone = creating ? "create" : "edit";
    const pickTenant = creating && allTenants;
    // In All tenants an account has no group of its own, the panel changes the one of each tenant.
    const withGroup = creating || !allTenants;
    const currentGroup = user ? user.group?.id ?? NO_GROUP : "";
    const form = useForm<Values>({
        resolver: zodResolver(schemaFor(creating, passwordRules, pickTenant)),
        defaultValues: { name: "", email: "", password: "", tenantId: "", groupId: "" },
    });
    const [name, email, password, tenantId] = useWatch({ control: form.control, name: ["name", "email", "password", "tenantId"] });
    const { tenants } = useTenantView();
    // A group belongs to one tenant, so a new account of the list of every account picks from the groups of its tenant.
    const offered = pickTenant ? (tenantId ? groupsOfTenant(groups, tenantId) : []) : groups;

    useEffect(() => {
        if (open) form.reset({ name: user?.name ?? "", email: user?.email ?? "", password: "", tenantId: "", groupId: currentGroup });
    }, [open, user, currentGroup, form]);

    const permissions = useViewerPermissions();
    // Nobody changes their own group or takes one that may do more than they may.
    const groupLocked = user ? groupLock(user, groups, { platformAdmin: viewerPlatformAdmin, permissions }) : null;
    // The account of a platform admin is for a platform admin, one that also works in another tenant
    // also for whoever manages the accounts of the platform.
    const accountLocked = user ? accountLock(user, viewerPlatformAdmin, permissions?.includes(PERMISSIONS.PLATFORM.ACCOUNTS_WRITE) ?? false) : null;
    const saving = form.formState.isSubmitting;

    const submit = async (values: Values) => {
        try {
            if (!user) {
                const result = await createUser({
                    name: values.name,
                    email: values.email,
                    password: values.password,
                    groupId: values.groupId === NO_GROUP ? null : values.groupId,
                    ...(pickTenant ? { tenantId: values.tenantId } : {}),
                });
                if (!result.success) {
                    toast.error(result.error || "The user could not be created.");
                    return;
                }
                toast.success(`${values.name} can sign in now`);
            } else {
                if (!accountLocked && (values.name !== user.name || values.email !== user.email)) {
                    const result = await updateUser(user.id, { name: values.name, email: values.email });
                    if (!result.success) {
                        toast.error(result.error || "The user could not be saved.");
                        return;
                    }
                }
                if (withGroup && values.groupId !== currentGroup) {
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
                                {creating
                                    ? pickTenant ? "Signs in right away with the password, with the access of the group in the tenant" : "Signs in right away with the password, with the access of the group"
                                    : accountLocked ? "Only the group" : withGroup ? "The name, the email and the group" : "The name and the email, the panel changes the group of each tenant"}
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
                                                    <Input placeholder="Jane Doe" autoComplete="off" {...field} disabled={accountLocked !== null} />
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
                                                    <Input type="email" placeholder="jane@example.com" autoComplete="off" {...field} disabled={accountLocked !== null} />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                    {accountLocked && <p className="text-xs text-muted-foreground sm:col-span-2">{accountLocked}</p>}
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

                                {pickTenant && (
                                    <FormField
                                        control={form.control}
                                        name="tenantId"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Tenant</FormLabel>
                                                <FormControl>
                                                    <TenantField
                                                        tenants={tenants}
                                                        value={field.value}
                                                        onChange={(next) => {
                                                            if (next !== field.value) form.setValue("groupId", "");
                                                            field.onChange(next);
                                                        }}
                                                        onBlur={field.onBlur}
                                                        ref={field.ref}
                                                    />
                                                </FormControl>
                                                <FormDescription>The account belongs to every tenant it works in. Add more in its panel later.</FormDescription>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                )}

                                {withGroup && (
                                    <FormField
                                        control={form.control}
                                        name="groupId"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>{pickTenant ? "Group in the tenant" : "Group"}</FormLabel>
                                                <FormControl>
                                                    <GroupPicker
                                                        groups={offered}
                                                        viewerPlatformAdmin={viewerPlatformAdmin}
                                                        // Only the home tenant keeps an account without a group.
                                                        allowNone={pickTenant ? tenantId === HOME_TENANT_ID : !creating || allowNoGroup}
                                                        value={field.value}
                                                        onChange={field.onChange}
                                                        disabled={groupLocked !== null || (pickTenant && !tenantId)}
                                                        onBlur={field.onBlur}
                                                        ref={field.ref}
                                                    />
                                                </FormControl>
                                                {groupLocked && <FormDescription>{groupLocked}</FormDescription>}
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                )}
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
