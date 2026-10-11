/**
 * The Test connection button of every connection of the lab: each source, destination and
 * channel answers with the logins and settings the seed gave it.
 */

import { describe, expect, it } from "vitest";
import prisma from "@/lib/prisma";
import { checkConnection } from "../../lab/src/check";

const connections = await prisma.adapterConfig.findMany({ orderBy: [{ type: "asc" }, { name: "asc" }] });

describe("Test connection", () => {
    it.each(connections)("passes for $name", async (connection) => {
        const result = await checkConnection(connection);
        expect(result.ok, result.message).toBe(true);
    });
});
