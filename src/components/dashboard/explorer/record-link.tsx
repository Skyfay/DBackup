"use client";

import Link from "next/link";
import { useOpenRecord } from "@/components/tenant/tenant-actions";
import { useTenantView } from "@/components/tenant/tenant-view";

type RecordLinkProps = Omit<React.ComponentProps<typeof Link>, "href"> & {
    href: string;
    /** The tenant of the record, which a plain click opens the page in while the list holds every tenant. */
    tenantId: string | null | undefined;
};

/**
 * A link to the page of a database or a server. In All tenants a plain click switches into the
 * tenant of the record first and opens the page there, where it can be changed. A click with a
 * modifier, like one into a new tab, stays a plain link.
 */
export function RecordLink({ href, tenantId, onClick, ...props }: RecordLinkProps) {
    const { allTenants } = useTenantView();
    const openRecord = useOpenRecord();
    return (
        <Link
            href={href}
            {...props}
            onClick={(event) => {
                onClick?.(event);
                if (event.defaultPrevented || !allTenants || !tenantId) return;
                if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                openRecord(tenantId, href, () => undefined);
            }}
        />
    );
}
