"use client";

import { ArrowRightToLine, Building2, Fingerprint, Globe, Link2, Lock, LogIn, Mail, RectangleEllipsis } from "lucide-react";
import { ExplorerStrip } from "@/components/dashboard/storage/explorer/explorer-strip";
import { listed } from "@/components/dashboard/users/user-strip";
import { listWords } from "@/lib/auth/access-summary";
import type { SsoProvidersModel } from "@/services/sso/sso-providers-types";

/** "3 through Authentik, 1 through Pocket ID", the two that link the most. */
function linkedLine(linkedBy: SsoProvidersModel["stats"]["linkedBy"]): string {
    const shown = linkedBy.slice(0, 2).map((entry) => `${entry.count} through ${entry.name}`);
    return linkedBy.length > 2 ? `${shown.join(", ")} and more` : shown.join(", ");
}

/**
 * The numbers above the providers: which are on, who is linked, who has no other way in, and the
 * other ways. With more than one tenant it counts the buttons of the login page and the tenants
 * with a provider of their own in place of who has no other way in and the sign-ins.
 */
export function SignInStrip({ model }: { model: SsoProvidersModel | null }) {
    const stats = model?.stats;
    const off = stats && stats.disabled.length > 0 ? `, ${listWords(stats.disabled)} off` : "";
    const providers = {
        label: "Providers",
        icon: model && model.tenants.length > 1 ? LogIn : Building2,
        value: stats ? stats.providers.toLocaleString() : "-",
        extra: stats ? (stats.providers === 0 ? "none yet" : `${stats.enabled} on${off}`) : " ",
    };
    const linked = {
        label: "Linked people",
        icon: Link2,
        value: stats ? stats.linked.toLocaleString() : "-",
        extra: stats ? (stats.linked === 0 ? "nobody yet" : linkedLine(stats.linkedBy)) : " ",
    };
    const password = {
        label: "Password sign-in",
        icon: RectangleEllipsis,
        value: model ? (model.passwordSignIn ? "On" : "Off") : "-",
        extra: model ? (model.passwordSignIn ? "DISABLE_EMAIL_LOGIN is not set" : "DISABLE_EMAIL_LOGIN is set") : " ",
    };
    if (model && stats && model.tenants.length > 1) {
        return (
            <ExplorerStrip joined
                cells={[
                    providers,
                    {
                        label: "On the login page",
                        icon: Globe,
                        value: stats.onLoginPage.length.toLocaleString(),
                        extra: stats.onLoginPage.length === 0 ? "no button, only the email" : `${listWords(stats.onLoginPage)}, the providers of the platform`,
                    },
                    {
                        label: "Tenants with their own",
                        icon: Building2,
                        value: stats.tenantsWithOwn.toLocaleString(),
                        extra: stats.byEmail.length === 0 ? "reached by the email of their domain" : `${listWords(stats.byEmail)} reach their provider by the email`,
                    },
                    linked,
                    password,
                ]}
            />
        );
    }
    return (
        <ExplorerStrip joined
            cells={[
                providers,
                linked,
                {
                    label: "Only through a provider",
                    icon: Lock,
                    value: stats ? stats.onlyThrough.length.toLocaleString() : "-",
                    extra: stats
                        ? stats.onlyThrough.length === 0
                            ? "everyone has another way in"
                            : `${listed(stats.onlyThrough)} ${stats.onlyThrough.length === 1 ? "has" : "have"} no password or passkey`
                        : " ",
                },
                {
                    label: "Sign-ins through them",
                    icon: LogIn,
                    value: stats ? stats.signIns.toLocaleString() : "-",
                    extra: "in the last 30 days",
                },
                password,
            ]}
        />
    );
}

/**
 * What else decides how people sign in, under the list: passkeys, the login page and the
 * automatic redirect, and for someone who is no platform admin why nothing can be changed.
 */
export function SignInFoot({ model, canManage }: { model: SsoProvidersModel; canManage: boolean }) {
    // Only the providers of the platform are buttons, those of tenants are reached by the email.
    const on = model.stats.onLoginPage;
    const byEmail = model.stats.byEmail;
    const target = model.autoRedirect ? model.providers.find((provider) => provider.providerId === model.autoRedirect) : undefined;
    const redirect = !model.autoRedirect
        ? "No automatic redirect, OIDC_AUTO_REDIRECT is not set"
        : !target
          ? `OIDC_AUTO_REDIRECT names ${model.autoRedirect}, which is no provider here`
          : target.tenant
            ? `OIDC_AUTO_REDIRECT names ${target.name}, a provider of a tenant, so nothing redirects`
            : target.enabled
              ? `The login page goes straight to ${target.name}, OIDC_AUTO_REDIRECT names it`
              : `OIDC_AUTO_REDIRECT names ${target.name}, which is off, so nothing redirects`;
    const items = [
        { icon: Fingerprint, text: model.passkeys ? "Passkeys on" : "Passkeys off in the settings" },
        { icon: LogIn, text: on.length > 0 ? `The login page shows ${listWords(on)}` : "The login page shows no provider" },
        ...(byEmail.length > 0 ? [{ icon: Mail, text: `${listWords(byEmail)} ${byEmail.length === 1 ? "reaches its" : "reach their"} tenant's provider from the email` }] : []),
        { icon: ArrowRightToLine, text: redirect },
        ...(canManage ? [] : [{ icon: Lock, text: "Only a platform admin adds and changes providers" }]),
    ];
    return (
        <ul className="flex flex-wrap gap-x-5 gap-y-1.5 px-1 pt-1 text-xs text-muted-foreground md:pt-3">
            {items.map(({ icon: Icon, text }) => (
                <li key={text} className="flex min-w-0 items-center gap-1.5">
                    <Icon className="size-3.5 shrink-0" aria-hidden="true" />
                    <span className="min-w-0">{text}</span>
                </li>
            ))}
        </ul>
    );
}
