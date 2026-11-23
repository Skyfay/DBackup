"use client";

import type { UseFormReturn } from "react-hook-form";
import { createPlatformUser } from "@/app/actions/auth/platform-group";
import { createUser } from "@/app/actions/auth/user";
import { ChoiceCards, type ModeOption } from "@/components/adapter/connection-mode-choice";
import { platformGroupNote, PlatformGroupPick } from "@/components/dashboard/platform/user-platform-group";
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { PLATFORM_ADMIN_GROUP_ID, type PlatformGroupsModel } from "@/services/user/platform-groups-types";
import { NO_GROUP } from "./user-columns";
import type { Values } from "./user-dialog-schema";

/**
 * New user under Platform makes one of two kinds of account: someone who works in a tenant, like
 * the people of a customer, with a group there, or someone of the MSP who runs the platform with a
 * platform group, Platform admin included, and needs no tenant.
 */

const KIND_OPTIONS: ModeOption[] = [
    { value: "tenant", title: "Works in a tenant", description: "Like the people of a customer, with a group in the tenant they work in" },
    { value: "platform", title: "Runs the platform", description: "Of the MSP, with a platform group like Platform admin, in no tenant" },
];

interface AccountKindFieldsProps {
    form: UseFormReturn<Values>;
    kind: Values["kind"];
    /** The platform groups and what the viewer may give, while it loads null. */
    model: PlatformGroupsModel | null;
    disabled: boolean;
}

/** The pick of the kind of a new account, and its platform group for an account of the platform. */
export function AccountKindFields({ form, kind, model, disabled }: AccountKindFieldsProps) {
    return (
        <>
            <FormField
                control={form.control}
                name="kind"
                render={({ field }) => (
                    <FormItem>
                        <FormLabel>Who it is for</FormLabel>
                        <FormControl>
                            <ChoiceCards value={field.value} onValueChange={field.onChange} options={KIND_OPTIONS} disabled={disabled} />
                        </FormControl>
                        <FormMessage />
                    </FormItem>
                )}
            />
            {kind === "platform" && (
                <FormField
                    control={form.control}
                    name="platform"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Platform group</FormLabel>
                            <FormControl>
                                <PlatformGroupPick
                                    user={{ platformGroup: null }}
                                    model={model}
                                    value={field.value}
                                    onPick={field.onChange}
                                    withNone={false}
                                    disabled={disabled}
                                    onBlur={field.onBlur}
                                    ref={field.ref}
                                />
                            </FormControl>
                            <FormDescription>
                                {field.value
                                    ? `${platformGroupNote({ superAdmin: field.value === PLATFORM_ADMIN_GROUP_ID }, model?.groups.find((group) => group.id === field.value))} Add a tenant with Edit when they also work in one.`
                                    : "What they may do on the platform and in which tenants. Add a tenant with Edit when they also work in one."}
                            </FormDescription>
                            <FormMessage />
                        </FormItem>
                    )}
                />
            )}
        </>
    );
}

/**
 * Creates the account the dialog holds: of the platform with its platform group, or in a tenant with
 * its group there, the open tenant unless the tenant is picked.
 */
export function createAccount(values: Values, pickTenant: boolean) {
    if (values.kind === "platform") {
        return createPlatformUser({
            name: values.name,
            email: values.email,
            password: values.password,
            platformGroup: values.platform === PLATFORM_ADMIN_GROUP_ID ? { kind: "admin" } : { kind: "group", id: values.platform },
        });
    }
    return createUser({
        name: values.name,
        email: values.email,
        password: values.password,
        groupId: values.groupId === NO_GROUP ? null : values.groupId,
        ...(pickTenant ? { tenantId: values.tenantId } : {}),
    });
}
