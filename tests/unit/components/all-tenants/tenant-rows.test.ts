import { describe, expect, it } from "vitest";
import type { ColumnDef } from "@tanstack/react-table";
import { compareTenantNames, matchesTenants, TENANT_COLUMN_ID, tenantFilterOptions, withTenantColumn } from "@/components/tenant/tenant-rows";

const TENANTS = [
    { id: "default", name: "Home" },
    { id: "acme", name: "Acme GmbH" },
    { id: "globex", name: "Globex" },
];

type Row = { name: string };
const column = (id: string, pin?: "start" | "end"): ColumnDef<Row> => ({ id, ...(pin ? { meta: { pin } } : {}) });
const ids = (columns: ColumnDef<Row>[]) => columns.map((entry) => entry.id);

describe("the Tenant filter of a list in All tenants", () => {
    it("offers the tenants that hold a row, each once and by name", () => {
        expect(tenantFilterOptions(TENANTS, ["globex", "acme", "globex", null, undefined, ""])).toEqual([
            { value: "acme", label: "Acme GmbH" },
            { value: "globex", label: "Globex" },
        ]);
    });

    it("offers every tenant to a list the server pages, which does not hold every row", () => {
        expect(tenantFilterOptions(TENANTS).map((option) => option.label)).toEqual(["Acme GmbH", "Globex", "Home"]);
    });

    it("keeps a tenant the viewer does not know by its id, so its rows can still be filtered", () => {
        expect(tenantFilterOptions(TENANTS, ["initech"])).toEqual([{ value: "initech", label: "initech" }]);
    });

    it("lets every row pass while no tenant is picked, and only the rows of the picked ones after", () => {
        expect(matchesTenants("acme", undefined)).toBe(true);
        expect(matchesTenants("acme", [])).toBe(true);
        expect(matchesTenants("acme", ["acme", "globex"])).toBe(true);
        expect(matchesTenants("default", ["acme"])).toBe(false);
        expect(matchesTenants(undefined, ["acme"])).toBe(false);
    });
});

describe("the Tenant column of a list in All tenants", () => {
    it("sits right after the columns pinned to the start, beside the name", () => {
        const columns = [column("select", "start"), column("name", "start"), column("status"), column("actions", "end")];

        expect(ids(withTenantColumn(columns, column(TENANT_COLUMN_ID)))).toEqual(["select", "name", TENANT_COLUMN_ID, "status", "actions"]);
    });

    it("follows the first column of a list that pins none", () => {
        expect(ids(withTenantColumn([column("name"), column("size")], column(TENANT_COLUMN_ID)))).toEqual(["name", TENANT_COLUMN_ID, "size"]);
    });

    it("leaves the list as it is outside All tenants", () => {
        const columns = [column("name", "start"), column("status")];

        expect(withTenantColumn(columns, null)).toBe(columns);
    });

    it("sorts by the names of the tenants, the unknown ones last", () => {
        const nameOf = (id: string) => TENANTS.find((tenant) => tenant.id === id)?.name ?? null;

        expect(["globex", "initech", "acme", "default"].sort((a, b) => compareTenantNames(nameOf, a, b))).toEqual(["acme", "globex", "default", "initech"]);
    });
});
