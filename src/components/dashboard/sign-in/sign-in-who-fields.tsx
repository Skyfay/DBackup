"use client";

import { useId } from "react";
import { Lock, LogIn, Mail } from "lucide-react";
import { SwitchList, SwitchRow } from "@/components/adapter/setting-switches";
import { NO_GROUP } from "@/components/dashboard/users/user-columns";
import { GroupPicker } from "@/components/dashboard/users/user-group-picker";
import { Label } from "@/components/ui/label";
import { normalizeDomain } from "@/lib/auth/sso-domain";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import { cn } from "@/lib/utils";
import type { SsoProvidersModel, SsoTenant } from "@/services/sso/sso-providers-types";
import { OptionalMark, ProviderField } from "./sign-in-fields";
import type { SignInValues } from "./sign-in-form-values";
import { BelongsToPicker } from "./sign-in-tenant-picker";

interface LoginPageWayProps {
    tenant: SsoTenant | null;
    domain: string | null;
    name: string;
}

/**
 * How the login page reaches the provider, which follows from who it belongs to: a provider of the
 * platform is a button, one of a tenant only the email reaches. Shown as the two ways with the one
 * that applies picked, the other locked.
 */
function LoginPageWay({ tenant, domain, name }: LoginPageWayProps) {
    const ways = [
        {
            key: "button",
            icon: LogIn,
            title: "As a button",
            text: tenant
                ? "Only the providers of the platform show as buttons"
                : domain
                  ? `For everyone, and an email of ${domain} goes straight to it`
                  : "For everyone who opens the login page",
            on: !tenant,
        },
        {
            key: "email",
            icon: Mail,
            title: "By the email only",
            text: tenant ? `${domain ?? "Its domain"} signs in with ${name}, under the email field` : "Only the providers of tenants leave out the button",
            on: Boolean(tenant),
        },
    ];
    return (
        <div className="space-y-2">
            <p className="text-sm leading-none font-medium">On the login page</p>
            <ul className="grid gap-2">
                {ways.map(({ key, icon: Icon, title, text, on }) => (
                    <li key={key} className={cn("flex items-start gap-3 rounded-lg border px-3 py-2.5", on ? "border-tone/30 bg-tone/12" : "text-muted-foreground")}>
                        <Icon className={cn("mt-0.5 size-4 shrink-0", on && "text-tone")} aria-hidden="true" />
                        <span className="min-w-0 flex-1">
                            <span className={cn("block text-sm font-medium", on && "text-foreground")}>{title}</span>
                            <span className="block text-xs text-muted-foreground">{text}</span>
                        </span>
                        {on ? <span className="sr-only">Applies</span> : <Lock className="mt-0.5 size-3.5 shrink-0" aria-label="Does not apply" />}
                    </li>
                ))}
            </ul>
        </div>
    );
}

interface WhoFieldsProps {
    values: SignInValues;
    set: <K extends keyof SignInValues>(key: K, value: SignInValues[K]) => void;
    model: SsoProvidersModel;
    /** The name of the provider type, like Keycloak. */
    adapterName: string;
    errorOf: (field: string) => string | null;
}

/**
 * The part of the provider form about who signs in: the tenant it belongs to, its email domain,
 * how the login page reaches it and where new people land. With one tenant only the domain and the
 * new people, as before there were tenants.
 */
export function WhoFields({ values, set, model, adapterName, errorOf }: WhoFieldsProps) {
    const tenantFieldId = useId();
    const groupFieldId = useId();
    const multiTenant = model.tenants.length > 1;
    const home = model.tenants.find((entry) => entry.id === HOME_TENANT_ID) ?? { id: HOME_TENANT_ID, name: "the home tenant" };
    const tenant = values.tenantId ? model.tenants.find((entry) => entry.id === values.tenantId) ?? { id: values.tenantId, name: values.tenantId } : null;
    const landsIn = tenant ?? home;
    const groups = (model.manage?.groups ?? []).filter((group) => group.tenantId === landsIn.id);
    const name = values.name.trim() || adapterName;
    const domain = normalizeDomain(values.domain);
    const noGroup = values.groupId === NO_GROUP;

    return (
        <div className="space-y-4">
            <div>
                <p className="text-sm font-semibold">Who signs in</p>
                <p className="text-xs text-muted-foreground">
                    {multiTenant ? "Which tenant it belongs to, who reaches it and where new people land." : "Who reaches it and where new people land."}
                </p>
            </div>

            {multiTenant && (
                <div className="space-y-2">
                    <Label htmlFor={tenantFieldId}>Belongs to</Label>
                    <BelongsToPicker
                        id={tenantFieldId}
                        tenants={model.tenants}
                        value={values.tenantId}
                        onChange={(tenantId) => {
                            if (tenantId === values.tenantId) return;
                            set("tenantId", tenantId);
                            // A group belongs to one tenant, so another tenant asks for its own.
                            set("groupId", "");
                        }}
                    />
                    <p className="text-xs text-muted-foreground">
                        {tenant
                            ? `Only people of ${tenant.name} sign in through it, with an email of its domain. Only platform admins change it.`
                            : "Everyone sees it on the login page. New people land in the home tenant."}
                    </p>
                </div>
            )}

            <ProviderField
                label="Email domain"
                value={values.domain}
                onChange={(value) => set("domain", value)}
                placeholder="example.com"
                mono
                aside={tenant ? undefined : <OptionalMark />}
                error={errorOf("domain")}
                description={`Someone who types an email of this domain on the login page goes straight to ${name}. A domain belongs to one provider.`}
            />

            {multiTenant && <LoginPageWay tenant={tenant} domain={domain} name={name} />}

            <SwitchList>
                <SwitchRow
                    title="Add new people on their first sign-in"
                    description={
                        tenant
                            ? `Without it only members of ${tenant.name} sign in through ${adapterName}.`
                            : `Without it only people with an account in DBackup of the same email sign in through ${adapterName}.`
                    }
                    checked={values.allowProvisioning}
                    onCheckedChange={(checked) => set("allowProvisioning", checked)}
                />
            </SwitchList>
            {values.allowProvisioning && (
                <div className="space-y-2">
                    <Label htmlFor={groupFieldId}>{multiTenant ? `They land in ${landsIn.name} with the group` : "Group of new people"}</Label>
                    {/* Only a platform admin changes providers, so every group of the tenant can be picked. */}
                    <GroupPicker id={groupFieldId} groups={groups} viewerPlatformAdmin allowNone={!tenant} value={values.groupId} onChange={(id) => set("groupId", id)} />
                    {errorOf("group") ? (
                        <p className="text-xs text-destructive">{errorOf("group")}</p>
                    ) : (
                        <p className={cn("text-xs", noGroup ? "text-warning" : "text-muted-foreground")}>
                            {noGroup
                                ? "They sign in, but see and do nothing until someone picks a group."
                                : tenant
                                  ? `They sign in at once and reach no other tenant. An account of the domain that signs in through it for the first time joins ${tenant.name} too.`
                                  : "They sign in at once and do what the group allows."}
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}
