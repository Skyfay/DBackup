"use client";

import { Building2, EyeOff, Globe, Share2 } from "lucide-react";
import type { AdapterConfig } from "./types";
import { Muted } from "./connection-cells";

/**
 * The cells of a list of connections that tell whose a connection is: the own ones, the ones another
 * tenant shares with this one, and who gets the ones this tenant shares. See src/services/sharing/.
 */

/** A tenant by its name, in the chip the lists of tenants use. */
export function TenantNameChip({ name }: { name: string }) {
    return (
        <span className="inline-flex max-w-48 items-center gap-1.5 rounded-md bg-muted px-2 py-0.5 text-xs font-medium" title={name}>
            <Building2 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate">{name}</span>
        </span>
    );
}

/** The tenant that gives a connection, or databases of its server, to this one. Null for an own connection. */
export function providerOf(config: Pick<AdapterConfig, "provided" | "sharedServer">): string | null {
    return config.provided?.providerName ?? config.sharedServer?.providerName ?? null;
}

/** Whose a connection is: Yours, or the tenant that shares it. */
export function FromCell({ config }: { config: AdapterConfig }) {
    const provider = providerOf(config);
    return provider ? <TenantNameChip name={provider} /> : <Muted>Yours</Muted>;
}

/**
 * Where a provided connection points, which stays with the tenant that shares it. An email channel
 * that lets this tenant name the recipients shows them, or says that none are named yet.
 */
export function ProvidedAddressCell({ config }: { config: AdapterConfig }) {
    const terms = config.provided;
    if (terms?.ownRecipients) {
        const recipients = terms.recipients ?? [];
        if (recipients.length === 0) return <span className="text-sm text-warning">No recipients yet</span>;
        const text = recipients.join(", ");
        return (
            <span className="block max-w-96 min-w-0">
                <span className="block truncate text-sm" title={text}>{text}</span>
                <span className="block text-xs text-muted-foreground">Your recipients</span>
            </span>
        );
    }
    return (
        <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            <EyeOff className="size-3.5 shrink-0" aria-hidden="true" />
            {config.type === "notification" ? `${terms?.providerName ?? "Its tenant"} decides` : "Address hidden"}
        </span>
    );
}

/** Who gets a connection this tenant shares: every tenant, the names of a few, or nobody. */
export function SharedWithCell({ config }: { config: AdapterConfig }) {
    const share = config.share;
    if (!share) return <Muted>Only this tenant</Muted>;
    if (share.allTenants) {
        return (
            <span className="block min-w-0">
                <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-0.5 text-xs font-medium">
                    <Globe className="size-3.5 text-muted-foreground" aria-hidden="true" />
                    All tenants
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{share.tenants.length} today, new ones too</span>
            </span>
        );
    }
    const names = share.tenants.map((tenant) => tenant.name).join(", ");
    return (
        <span className="block min-w-0">
            <span className="inline-flex items-center gap-1.5 text-sm font-medium">
                <Share2 className="size-3.5 text-muted-foreground" aria-hidden="true" />
                {share.tenants.length === 1 ? "1 tenant" : `${share.tenants.length} tenants`}
            </span>
            <span className="block max-w-56 truncate text-xs text-muted-foreground" title={names}>{names}</span>
        </span>
    );
}
