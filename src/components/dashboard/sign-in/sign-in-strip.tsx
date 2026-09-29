"use client";

import { ArrowRightToLine, Fingerprint, LogIn } from "lucide-react";
import { ExplorerStrip } from "@/components/dashboard/storage/explorer/explorer-strip";
import { listed } from "@/components/dashboard/users/user-strip";
import { listWords } from "@/lib/auth/access-summary";
import type { SsoProvidersModel } from "@/services/sso/sso-providers-types";

/** "3 through Authentik, 1 through Pocket ID", the two that link the most. */
function linkedLine(linkedBy: SsoProvidersModel["stats"]["linkedBy"]): string {
    const shown = linkedBy.slice(0, 2).map((entry) => `${entry.count} through ${entry.name}`);
    return linkedBy.length > 2 ? `${shown.join(", ")} and more` : shown.join(", ");
}

/** The numbers above the providers: which are on, who is linked, who has no other way in, and the other ways. */
export function SignInStrip({ model }: { model: SsoProvidersModel | null }) {
    const stats = model?.stats;
    const off = stats && stats.disabled.length > 0 ? `, ${listWords(stats.disabled)} off` : "";
    return (
        <ExplorerStrip joined
            cells={[
                {
                    label: "Providers",
                    value: stats ? stats.providers.toLocaleString() : "-",
                    extra: stats ? (stats.providers === 0 ? "none yet" : `${stats.enabled} on${off}`) : " ",
                },
                {
                    label: "Linked people",
                    value: stats ? stats.linked.toLocaleString() : "-",
                    extra: stats ? (stats.linked === 0 ? "nobody yet" : linkedLine(stats.linkedBy)) : " ",
                },
                {
                    label: "Only through a provider",
                    value: stats ? stats.onlyThrough.length.toLocaleString() : "-",
                    extra: stats
                        ? stats.onlyThrough.length === 0
                            ? "everyone has another way in"
                            : `${listed(stats.onlyThrough)} ${stats.onlyThrough.length === 1 ? "has" : "have"} no password or passkey`
                        : " ",
                },
                {
                    label: "Sign-ins through them",
                    value: stats ? stats.signIns.toLocaleString() : "-",
                    extra: "in the last 30 days",
                },
                {
                    label: "Password sign-in",
                    value: model ? (model.passwordSignIn ? "On" : "Off") : "-",
                    extra: model ? (model.passwordSignIn ? "DISABLE_EMAIL_LOGIN is not set" : "DISABLE_EMAIL_LOGIN is set") : " ",
                },
            ]}
        />
    );
}

/** What else decides how people sign in, under the list: passkeys, the login page and the automatic redirect. */
export function SignInFoot({ model }: { model: SsoProvidersModel }) {
    const on = model.providers.filter((provider) => provider.enabled).map((provider) => provider.name);
    const target = model.autoRedirect ? model.providers.find((provider) => provider.providerId === model.autoRedirect) : undefined;
    const redirect = !model.autoRedirect
        ? "No automatic redirect, OIDC_AUTO_REDIRECT is not set"
        : !target
          ? `OIDC_AUTO_REDIRECT names ${model.autoRedirect}, which is no provider here`
          : target.enabled
            ? `The login page goes straight to ${target.name}, OIDC_AUTO_REDIRECT names it`
            : `OIDC_AUTO_REDIRECT names ${target.name}, which is off, so nothing redirects`;
    const items = [
        { icon: Fingerprint, text: model.passkeys ? "Passkeys on" : "Passkeys off in the settings" },
        { icon: LogIn, text: on.length > 0 ? `The login page shows ${listWords(on)}` : "The login page shows no provider" },
        { icon: ArrowRightToLine, text: redirect },
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
