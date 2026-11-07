import { describe, expect, it } from "vitest";
import { escapeMysqlIdentifier, escapeMysqlLiteral } from "@/lib/adapters/database/mysql/sql-quote";

/**
 * Reads the single-quoted literal at the start of `sql` the way MySQL does, with or without
 * NO_BACKSLASH_ESCAPES, and returns its value and what follows it.
 */
function readLiteral(sql: string, noBackslashEscapes: boolean): { value: string; rest: string } {
    expect(sql[0]).toBe("'");
    let value = "";
    for (let i = 1; i < sql.length; i++) {
        const c = sql[i];
        if (c === "\\" && !noBackslashEscapes) {
            value += sql[++i];
        } else if (c === "'" && sql[i + 1] === "'") {
            value += "'";
            i++;
        } else if (c === "'") {
            return { value, rest: sql.slice(i + 1) };
        } else {
            value += c;
        }
    }
    throw new Error("The literal never ends.");
}

const hostile = ["it's", "x\\' OR 1=1 -- ", "\\", "\\\\'", "'; DROP DATABASE shop; --", "a\\'b'c\\\\"];

describe("MySQL quoting", () => {
    it.each(hostile)("keeps %s inside the literal without NO_BACKSLASH_ESCAPES, value unchanged", (value) => {
        const { value: read, rest } = readLiteral(`'${escapeMysqlLiteral(value)}' AND 1`, false);

        expect(read).toBe(value);
        expect(rest).toBe(" AND 1");
    });

    it.each(hostile)("keeps %s inside the literal under NO_BACKSLASH_ESCAPES", (value) => {
        const { rest } = readLiteral(`'${escapeMysqlLiteral(value)}' AND 1`, true);

        expect(rest).toBe(" AND 1");
    });

    it("writes a quote as two quotes, never as a backslash and a quote", () => {
        expect(escapeMysqlLiteral("o'reilly")).toBe("o''reilly");
    });

    it("drops a NUL", () => {
        expect(escapeMysqlLiteral("a\0b")).toBe("ab");
        expect(escapeMysqlIdentifier("a\0b")).toBe("ab");
    });

    it("doubles a backtick in an identifier", () => {
        expect(escapeMysqlIdentifier("we`ird")).toBe("we``ird");
    });
});
