"use client";

import { useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { Loader2, Pencil, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { updateUser, updateUserGroup } from "@/app/actions/auth/user";
import { PasswordChecklist } from "@/components/auth/password-checklist";
import { PlatformAdminConfirmDialog } from "@/components/dashboard/platform/platform-admin-role";
import { useViewerPermissions } from "@/components/permissions/permissions-context";
import { useTenantView } from "@/components/tenant/tenant-view";
import { Button } from "@/components/ui/button";
import { DIALOG_FOOTER, DIALOG_SURFACE, DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { usePageModel } from "@/hooks/use-page-model";
import type { PasswordRules } from "@/lib/auth/password-policy";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { cn } from "@/lib/utils";
import { PLATFORM_ADMIN_GROUP_ID, type PlatformGroupsModel } from "@/services/user/platform-groups-types";
import type { UserRow, UsersGroup } from "@/services/user/users-types";
import { accountLock, groupLock, groupsOfTenant } from "./user-access";
import { accessNote, platformChange, saveAccess, useAccessEdit, UserAccessFields } from "./user-dialog-access";
import { AccountKindFields, createAccount } from "./user-dialog-kind";
import { NO_GROUP } from "./user-columns";
import { GroupPicker } from "./user-group-picker";
import { PasswordField } from "./user-password-field";
import { schemaFor, type Values } from "./user-dialog-schema";
import { TenantField, tenantGroupsMeta } from "./user-tenant-field";

const log = logger.child({ component: "user-dialog" });

/** Leaves room for the head and the foot on a short screen. */
const BODY_SCROLL = "min-h-0 flex-1 *:data-[slot=scroll-area-viewport]:max-h-[calc(95dvh-9.5rem)]";

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
     * group, and Edit changes the name, the email and, for whoever may, the tenants and the
     * platform group.
     */
    allTenants?: boolean;
    /** May give and take the group of an account in each tenant, in All tenants. */
    manageTenants?: boolean;
    /** May give platform groups, under Platform. */
    managePlatformGroup?: boolean;
    onOpenChange: (open: boolean) => void;
    onSaved: () => void;
}

/**
 * New user and Edit user: the name, the email, a first password for a new one and the group. Under
 * Platform New user makes someone who works in a tenant or, for whoever gives platform groups,
 * someone who runs the platform with a platform group. In All tenants Edit holds the platform group
 * and the group in each tenant in place of the group, all saved with Save. The name and the email of
 * an account the viewer may not change stay as they are, the group can still change.
 */
export function UserDialog({ open, user, groups, passwordRules, viewerPlatformAdmin, allowNoGroup, allTenants = false, manageTenants = false, managePlatformGroup = false, onOpenChange, onSaved }: UserDialogProps) {
    const creating = user === null;
    const tone = creating ? "create" : "edit";
    const pickTenant = creating && allTenants;
    // In All tenants an account has no group of its own, the panel changes the one of each tenant.
    const withGroup = creating || !allTenants;
    const currentGroup = user ? user.group?.id ?? NO_GROUP : "";
    const form = useForm<Values>({
        resolver: zodResolver(schemaFor(creating, passwordRules, pickTenant)),
        defaultValues: { name: "", email: "", password: "", kind: "tenant", tenantId: "", groupId: "", platform: "" },
    });
    const [name, email, password, tenantId, kind] = useWatch({ control: form.control, name: ["name", "email", "password", "tenantId", "kind"] });
    // Whoever gives platform groups also makes an account of the platform with New user under Platform.
    const choosesKind = pickTenant && managePlatformGroup;
    const forPlatform = choosesKind && kind === "platform";
    const { model: newPlatformModel } = usePageModel<PlatformGroupsModel>(open && choosesKind ? "/api/platform/platform-groups" : null, "The platform groups could not be loaded.");
    const { tenants } = useTenantView();
    // A group belongs to one tenant, so a new account of the list of every account picks from the groups of its tenant.
    const offered = pickTenant ? (tenantId ? groupsOfTenant(groups, tenantId) : []) : groups;

    // In All tenants Edit also holds the platform group and the tenants, for whoever may change them.
    const { withAccess, parts, platformModel, access, setAccess, line: accessLine } = useAccessEdit({ open, user, allTenants, manageTenants, managePlatformGroup, viewerPlatformAdmin });
    const [asking, setAsking] = useState<Values | null>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (!open) return;
        form.reset({ name: user?.name ?? "", email: user?.email ?? "", password: "", kind: "tenant", tenantId: "", groupId: currentGroup, platform: "" });
        setAsking(null);
    }, [open, user, currentGroup, form]);

    const permissions = useViewerPermissions();
    // Nobody changes their own group or takes one that may do more than they may.
    const groupLocked = user ? groupLock(user, groups, { platformAdmin: viewerPlatformAdmin, permissions }) : null;
    // The account of a platform admin is for a platform admin, one that also works in another tenant
    // also for whoever manages the accounts of the platform.
    const accountLocked = user ? accountLock(user, viewerPlatformAdmin, permissions?.includes(PERMISSIONS.PLATFORM.ACCOUNTS_WRITE) ?? false) : null;
    const saving = form.formState.isSubmitting || busy;

    const submit = async (values: Values, confirmed = false) => {
        // Giving or ending the platform admin role asks first, before anything is saved.
        const asks = user ? withAccess && platformChange(user, access, parts).asks : forPlatform && values.platform === PLATFORM_ADMIN_GROUP_ID;
        if (asks && !confirmed) {
            setAsking(values);
            return;
        }
        setBusy(true);
        try {
            if (!user) {
                const result = await createAccount({ ...values, kind: forPlatform ? "platform" : "tenant" }, pickTenant);
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
                if (withAccess && !(await saveAccess(user, access, parts))) {
                    // What went through before the refusal shows once the list loads again.
                    onSaved();
                    return;
                }
                toast.success("User saved");
            }
            onSaved();
            onOpenChange(false);
        } catch (error) {
            // Without the right to change users the actions throw instead of answering.
            log.warn("Saving a user failed", { userId: user?.id }, wrapError(error));
            toast.error("The user could not be saved.");
        } finally {
            setBusy(false);
            setAsking(null);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
            <DialogContent tone={tone} showCloseButton={false} className={cn(DIALOG_SURFACE, parts.tenants ? "sm:max-w-3xl" : "sm:max-w-2xl")}>
                <Form {...form}>
                    <form onSubmit={form.handleSubmit((values) => submit(values))} noValidate className="flex min-h-0 flex-1 flex-col">
                        <DialogHead tone={tone} icon={creating ? UserPlus : Pencil}>
                            <DialogTitle className="truncate text-base">{creating ? "New user" : `Edit ${user.name}`}</DialogTitle>
                            <DialogDescription className={dialogNoteClass(tone)}>
                                {creating
                                    ? forPlatform
                                        ? "Signs in right away with the password, with the rights of the platform group"
                                        : pickTenant ? "Signs in right away with the password, with the access of the group in the tenant" : "Signs in right away with the password, with the access of the group"
                                    : withGroup ? (accountLocked ? "Only the group" : "The name, the email and the group") : accessNote(parts, accountLocked !== null)}
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

                                {choosesKind && <AccountKindFields form={form} kind={kind} model={newPlatformModel} disabled={saving} />}

                                {pickTenant && !forPlatform && (
                                    <FormField
                                        control={form.control}
                                        name="tenantId"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Tenant</FormLabel>
                                                <FormControl>
                                                    <TenantField
                                                        tenants={tenants}
                                                        metaOf={tenantGroupsMeta(groups)}
                                                        value={field.value}
                                                        onChange={(next) => {
                                                            if (next !== field.value) form.setValue("groupId", "");
                                                            field.onChange(next);
                                                        }}
                                                        onBlur={field.onBlur}
                                                        ref={field.ref}
                                                    />
                                                </FormControl>
                                                <FormDescription>The account belongs to every tenant it works in. Add more with Edit later.</FormDescription>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                )}

                                {user && withAccess && (
                                    <UserAccessFields user={user} groups={groups} platformModel={platformModel} parts={parts} value={access} onChange={setAccess} disabled={saving} />
                                )}

                                {withGroup && !forPlatform && (
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
                            {accessLine && <span className="mr-auto min-w-0 truncate text-xs text-muted-foreground" title={accessLine}>{accessLine}</span>}
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

                {asking && (
                    <PlatformAdminConfirmDialog
                        name={user ? user.name || user.email : asking.name}
                        on={user ? access.platform === PLATFORM_ADMIN_GROUP_ID : true}
                        pending={busy}
                        onClose={() => !busy && setAsking(null)}
                        onConfirm={() => void submit(asking, true)}
                    />
                )}
            </DialogContent>
        </Dialog>
    );
}
