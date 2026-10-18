import { describe, expect, it } from "vitest";
import { dbArg } from "@/lib/adapters/database/postgres/args";

describe("the database name a PostgreSQL tool connects to", () => {
    it("is a keyword value, so a name that reads like a connection string never names another server", () => {
        expect(dbArg("shop")).toBe("dbname='shop'");
        expect(dbArg("host=10.0.0.5 dbname=hr")).toBe("dbname='host=10.0.0.5 dbname=hr'");
        expect(dbArg("postgresql://admin@10.0.0.5/hr")).toBe("dbname='postgresql://admin@10.0.0.5/hr'");
    });

    it("escapes a quote and a backslash, so a name cannot end the value early", () => {
        expect(dbArg("shop' host='10.0.0.5")).toBe("dbname='shop\\' host=\\'10.0.0.5'");
        expect(dbArg("a\\b")).toBe("dbname='a\\\\b'");
    });
});
