// @vitest-environment node
/**
 * The tables of better-auth against the Prisma schema, the check better-auth makes before every
 * request and that src/lib/auth/index.ts turns off with `validateSchema: false`. A column better-auth
 * writes that the schema lacks, or a required column of the schema that better-auth leaves empty,
 * fails a sign-in. The sign-in providers are the exception, since DBackup writes them itself.
 */
import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { getAuthTables } from "better-auth/db";

const { auth } = await import("@/lib/auth");

/** What DBackup knowingly differs in: the organizations of the SSO plugin, and the columns it writes into a provider itself. */
const NOT_IN_SCHEMA = ["ssoProvider.organizationId"];
const WRITTEN_BY_DBACKUP = ["ssoProvider.adapterId", "ssoProvider.name"];

const lower = (name: string) => name.charAt(0).toLowerCase() + name.slice(1);

function differences() {
    const models = new Map(Prisma.dmmf.datamodel.models.map((model) => [lower(model.name), model]));
    const missing: string[] = [];
    const unwritten: string[] = [];
    for (const [key, table] of Object.entries(getAuthTables(auth.options))) {
        const name = lower(table.modelName ?? key);
        const model = models.get(name);
        if (!model) {
            missing.push(name);
            continue;
        }
        const written = new Set(["id", ...Object.entries(table.fields).map(([field, attributes]) => attributes.fieldName ?? field)]);
        const columns = model.fields.filter((field) => field.kind !== "object");
        for (const field of written) if (!columns.some((column) => column.name === field)) missing.push(`${name}.${field}`);
        for (const column of columns) {
            if (column.isRequired && !column.hasDefaultValue && !column.isUpdatedAt && !written.has(column.name)) unwritten.push(`${name}.${column.name}`);
        }
    }
    return { missing, unwritten };
}

describe("the tables of better-auth in the Prisma schema", () => {
    it("hold every column better-auth writes, and no required column it leaves empty, but for the sign-in providers", () => {
        const { missing, unwritten } = differences();

        expect(missing).toEqual(NOT_IN_SCHEMA);
        expect(unwritten).toEqual(WRITTEN_BY_DBACKUP);
    });
});
