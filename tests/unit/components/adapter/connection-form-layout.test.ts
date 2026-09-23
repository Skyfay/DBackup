import { describe, expect, it } from "vitest";
import {
    NAME_KEY,
    errorKeysOf,
    firstSectionWithError,
    hasValue,
    sectionStatuses,
    type SectionLayout,
} from "@/components/adapter/connection-form-layout";

const layout: SectionLayout[] = [
    { id: "connection", label: "Connection", keys: [NAME_KEY, "host", "port"], expects: [NAME_KEY, "host"] },
    { id: "aliases", label: "Aliases", keys: ["databases"], expects: ["databases"] },
    { id: "options", label: "Options", keys: ["options"], expects: [] },
];

describe("connection form sections", () => {
    it("marks a part done once everything it expects has a value", () => {
        const statuses = sectionStatuses(layout, { [NAME_KEY]: "Shop", host: "db.internal", databases: [{ name: "erp" }] }, []);
        expect(statuses.connection).toEqual({ kind: "done" });
        expect(statuses.aliases).toEqual({ kind: "done" });
    });

    it("marks a part as still to fill in while something it expects is empty", () => {
        const statuses = sectionStatuses(layout, { [NAME_KEY]: "   ", host: "db.internal", databases: [] }, []);
        expect(statuses.connection).toEqual({ kind: "todo" });
        expect(statuses.aliases).toEqual({ kind: "todo" });
    });

    it("keeps a part without anything required quiet", () => {
        const statuses = sectionStatuses(layout, {}, []);
        expect(statuses.options).toEqual({ kind: "none" });
    });

    it("counts the fields with an error in each part, ahead of anything else", () => {
        const statuses = sectionStatuses(layout, { [NAME_KEY]: "Shop", host: "db.internal" }, [NAME_KEY, "port", "databases"]);
        expect(statuses.connection).toEqual({ kind: "error", count: 2 });
        expect(statuses.aliases).toEqual({ kind: "error", count: 1 });
    });

    it("puts an error on a key no part shows into the first part, so it is never out of sight", () => {
        const statuses = sectionStatuses(layout, {}, ["uri"]);
        expect(statuses.connection).toEqual({ kind: "error", count: 1 });
    });

    it("moves to the first part that holds an error, in the order the form lists them", () => {
        expect(firstSectionWithError(layout, ["options", "databases"])).toBe("aliases");
        expect(firstSectionWithError(layout, [])).toBeNull();
    });

    it("reads the failing keys from react-hook-form's errors, counting a list once", () => {
        const errors = {
            name: { type: "too_small", message: "Name is required" },
            config: {
                databases: [{ name: { type: "too_small", message: "Alias name is required" } }],
                connectionMode: { type: "invalid_value", message: "Choose how DBackup connects." },
            },
        };
        expect(errorKeysOf(errors)).toEqual([NAME_KEY, "databases", "connectionMode"]);
    });

    it("treats blank text and empty lists as empty, and zero or false as a value", () => {
        expect(hasValue(" ")).toBe(false);
        expect(hasValue([])).toBe(false);
        expect(hasValue(null)).toBe(false);
        expect(hasValue(0)).toBe(true);
        expect(hasValue(false)).toBe(true);
    });
});
