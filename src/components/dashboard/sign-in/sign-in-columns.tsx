"use client";

import type { ColumnDef } from "@tanstack/react-table";
import type { DataTableFilterableColumn } from "@/components/ui/data-table-types";
import type { SsoProviderRow, SsoTenant } from "@/services/sso/sso-providers-types";
import { BelongsTo, DomainCell, LastSignInCell, LinkedFaces, LoginPageCell, NewPeopleCell, PlaceCell, ProviderCell, ProviderStateBadge } from "./sign-in-cells";

/** The value of the Belongs to filter for the providers of the platform, which belong to no tenant. */
export const PLATFORM_VALUE = "platform";

/** The id of the Belongs to column, which its filter names too. */
export const BELONGS_TO_COLUMN = "belongsTo";

const belongsToValue = (provider: Pick<SsoProviderRow, "tenant">) => provider.tenant?.id ?? PLATFORM_VALUE;

interface ColumnOptions {
    onOpen: (provider: SsoProviderRow) => void;
    renderActions: (provider: SsoProviderRow) => React.ReactNode;
    /** The instance has more than one tenant, so a provider belongs to the platform or to one of them. */
    multiTenant: boolean;
}

type Column = ColumnDef<SsoProviderRow>;

/**
 * The columns of the sign-in providers. Provider and actions stay put, the rest can move and hide.
 * With more than one tenant the list says who each provider belongs to, its domain, how the login
 * page reaches it and which tenant new people land in, and where people sign in and the last
 * sign-in start hidden. With one tenant it stays as it was, the domain hidden.
 */
export function signInColumns({ onOpen, renderActions, multiTenant }: ColumnOptions): Column[] {
    const provider: Column = {
        accessorKey: "name",
        header: "Provider",
        meta: { pin: "start" },
        // The search finds a provider by its name, its ID, where it signs in, its domain or its tenant.
        filterFn: (row, _id, value: string) => {
            const query = value.trim().toLowerCase();
            const { name, providerId, host, domain, tenant } = row.original;
            return !query || [name, providerId, host ?? "", domain ?? "", tenant?.name ?? ""].some((field) => field.toLowerCase().includes(query));
        },
        cell: ({ row, table }) => <ProviderCell provider={row.original} compact={table.options.meta?.density === "compact"} onOpen={onOpen} />,
    };
    const belongsTo: Column = {
        id: BELONGS_TO_COLUMN,
        header: "Belongs to",
        accessorFn: (row) => row.tenant?.name ?? "",
        filterFn: (row, _id, value: string[] | undefined) => !value || value.length === 0 || value.includes(belongsToValue(row.original)),
        cell: ({ row }) => <BelongsTo tenant={row.original.tenant} />,
    };
    const domain: Column = {
        id: "domain",
        header: "Email domain",
        meta: { defaultHidden: !multiTenant },
        accessorFn: (row) => row.domain ?? "",
        cell: ({ row }) => <DomainCell domain={row.original.domain} />,
    };
    const loginPage: Column = {
        id: "loginPage",
        header: "Login page",
        accessorFn: (row) => (row.tenant ? 1 : 0),
        cell: ({ row }) => <LoginPageCell provider={row.original} />,
    };
    const place: Column = {
        id: "place",
        header: "Signs in at",
        meta: { defaultHidden: multiTenant },
        accessorFn: (row) => row.host ?? "",
        cell: ({ row }) => <div className="max-w-56"><PlaceCell provider={row.original} /></div>,
    };
    const linked: Column = {
        id: "linked",
        header: "Linked",
        accessorFn: (row) => row.linked.length,
        cell: ({ row }) => <LinkedFaces people={row.original.linked} />,
    };
    const lastSignIn: Column = {
        id: "lastSignIn",
        header: "Last sign-in",
        meta: { defaultHidden: multiTenant },
        accessorFn: (row) => (row.lastSignIn ? Date.parse(row.lastSignIn.at) : 0),
        cell: ({ row }) => <div className="max-w-44"><LastSignInCell provider={row.original} /></div>,
    };
    const newPeople: Column = {
        id: "newPeople",
        header: "New people",
        enableSorting: false,
        cell: ({ row }) => <div className="max-w-64"><NewPeopleCell provider={row.original} withTenant={multiTenant} /></div>,
    };
    const state: Column = {
        id: "state",
        header: "State",
        accessorFn: (row) => (row.enabled ? 1 : 0),
        cell: ({ row }) => <ProviderStateBadge provider={row.original} />,
    };
    const actions: Column = {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        meta: { pin: "end", label: "Actions" },
        enableHiding: false,
        enableSorting: false,
        cell: ({ row }) => <div className="flex justify-end">{renderActions(row.original)}</div>,
    };
    return multiTenant
        ? [provider, belongsTo, domain, loginPage, newPeople, linked, lastSignIn, place, state, actions]
        : [provider, place, domain, linked, lastSignIn, newPeople, state, actions];
}

/** The Belongs to filter: the platform and every tenant that brings a provider, with how many each brings. */
export function belongsToFilter(providers: SsoProviderRow[], tenants: SsoTenant[]): DataTableFilterableColumn<SsoProviderRow> {
    const count = (value: string) => providers.filter((provider) => belongsToValue(provider) === value).length;
    const own = tenants.filter((tenant) => providers.some((provider) => provider.tenant?.id === tenant.id));
    return {
        id: BELONGS_TO_COLUMN,
        title: "Belongs to",
        options: [
            { value: PLATFORM_VALUE, label: "Platform", count: count(PLATFORM_VALUE) },
            ...own.map((tenant) => ({ value: tenant.id, label: tenant.name, count: count(tenant.id) })),
        ],
    };
}
