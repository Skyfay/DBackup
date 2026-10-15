"use client";

import { Section } from "@/components/adapter/connection-details-sections";
import { Notice } from "@/components/dashboard/storage/restore/restore-parts";
import type { SsoProviderRow } from "@/services/sso/sso-providers-types";
import { BelongsTo } from "./sign-in-cells";

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="min-w-0">
            <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</dt>
            <dd className="mt-1 text-sm leading-relaxed">{children}</dd>
        </div>
    );
}

const Mono = ({ children }: { children: React.ReactNode }) => <span className="font-mono text-xs font-medium">{children}</span>;

/** How the login page reaches a provider. */
function Reach({ provider, redirected }: { provider: SsoProviderRow; redirected: boolean }) {
    if (provider.tenant) {
        return provider.domain
            ? <>An email of <Mono>{provider.domain}</Mono> on the login page. It never shows as a button.</>
            : <>Nobody yet. A provider of a tenant is reached by its email domain only, Edit gives it one.</>;
    }
    return (
        <>
            A button on the login page
            {provider.domain && <>, and an email of <Mono>{provider.domain}</Mono> goes straight to it</>}.
            {redirected && " The login page sends everyone straight to it, since OIDC_AUTO_REDIRECT names it."}
        </>
    );
}

/** Where the people a provider adds land, and what happens to an account that signs in through it for the first time. */
function Land({ provider, multiTenant }: { provider: SsoProviderRow; multiTenant: boolean }) {
    if (!provider.allowProvisioning) {
        return provider.tenant
            ? <>Nobody new. Only members of {provider.tenant.name} sign in through it, anyone else is turned away.</>
            : <>Nobody new. Only people with an account in DBackup of the same email sign in through it, someone new is turned away.</>;
    }
    if (!provider.group) {
        return (
            <Notice tone="warning" title="Added without a group">
                {provider.name} adds someone on their first sign-in. They sign in, but see and do nothing until someone picks a group for them.
            </Notice>
        );
    }
    if (!multiTenant) return <>{provider.name} adds someone on their first sign-in, into the group <span className="font-medium">{provider.group.name}</span>.</>;
    return (
        <>
            In <BelongsTo tenant={provider.landsIn} className="mx-0.5 align-middle" /> with the group <span className="font-medium">{provider.group.name}</span>. They reach no other tenant until someone adds them there.
            {provider.tenant && provider.domain && <> An account of <Mono>{provider.domain}</Mono> that signs in through it for the first time joins {provider.tenant.name} with that group too.</>}
        </>
    );
}

interface WhoSignsInProps {
    provider: SsoProviderRow;
    /** More than one tenant, so the provider belongs to the platform or to one of them. */
    multiTenant: boolean;
    /** OIDC_AUTO_REDIRECT names the provider. */
    redirected: boolean;
    /** The viewer may change it, so the head says how. */
    editable: boolean;
}

/** Who a provider belongs to, who reaches it, where new people land and who manages it, in the panel of a provider. */
export function WhoSignsIn({ provider, multiTenant, redirected, editable }: WhoSignsInProps) {
    return (
        <Section title="Who signs in" aside={editable ? "Edit to change" : undefined}>
            <dl className="space-y-3.5">
                {multiTenant && (
                    <Fact label="Belongs to">
                        <BelongsTo tenant={provider.tenant} />
                    </Fact>
                )}
                <Fact label="Who reaches it">
                    <Reach provider={provider} redirected={redirected && !provider.tenant} />
                </Fact>
                <Fact label="Where new people land">
                    <Land provider={provider} multiTenant={multiTenant} />
                </Fact>
                {multiTenant && <Fact label="Who manages it">The platform admins, under Platform, Users & Groups. A tenant changes none of its providers itself.</Fact>}
            </dl>
        </Section>
    );
}
