import { describe, it, expect } from "vitest";
import { dumpFormatFor, hasNativeCompression, stripAllDatabasesOption } from "@/lib/runner/steps/dump-databases";

describe("database dump settings for the seekable archive", () => {
    it("refuses to guess the dump format of an adapter it does not know", () => {
        expect(dumpFormatFor("postgres")).toBe("custom");
        expect(dumpFormatFor("valkey")).toBe("rdb");
        expect(() => dumpFormatFor("oracle")).toThrow(/No dump format is defined/);
    });

    it("stores dumps the engine already compressed as they are", () => {
        expect(hasNativeCompression("postgres")).toBe(true);
        expect(hasNativeCompression("postgres", "NONE")).toBe(false);
        expect(hasNativeCompression("mongodb")).toBe(true);
        expect(hasNativeCompression("azure-sql")).toBe(true);
        expect(hasNativeCompression("mysql")).toBe(false);
    });

    it("drops --all-databases and keeps every other option", () => {
        expect(stripAllDatabasesOption("--single-transaction --all-databases --quick"))
            .toEqual({ options: "--single-transaction --quick", stripped: true });
        expect(stripAllDatabasesOption("--all-databases-extra")).toEqual({ options: "--all-databases-extra", stripped: false });
        expect(stripAllDatabasesOption(undefined)).toEqual({ options: undefined, stripped: false });
    });
});
