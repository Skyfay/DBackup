import { describe, it, expect } from "vitest";

import { isPortOrDefault, plainHostProblem, validPort } from "@/lib/adapters/command-values";
import { buildConnectionString } from "@/lib/adapters/database/firebird/connection";
import { firebirdHostProblem } from "@/lib/adapters/database/firebird/host";
import { FirebirdSchema } from "@/lib/adapters/definitions";
import { AdapterError } from "@/lib/logging/errors";

/**
 * The values of a config an adapter puts into a string a program splits or parses itself. Inside
 * such a string a space, a `:`, a `/` or a leading `-` would make another word, host or option of it.
 */

describe("a port", () => {
    it("is a whole number from 1 to 65535, as a number or as text", () => {
        expect(validPort(3306, "mysql", 1)).toBe(3306);
        expect(validPort("2222", "rsync", 22)).toBe(2222);
        expect(validPort(" 65535 ", "rsync", 22)).toBe(65535);
    });

    it("falls back to the default when it is missing, empty or 0, as the forms store an empty one", () => {
        for (const value of [undefined, null, "", 0, "0"]) expect(validPort(value, "rsync", 22)).toBe(22);
        expect(isPortOrDefault(0)).toBe(true);
    });

    it("refuses anything that could carry more than a number", () => {
        for (const value of ["22 -oProxyCommand=x", "22\n-o x", 1.5, "1e3", -1, 65536, "0x16", true, {}, [22]]) {
            expect(() => validPort(value, "rsync", 22)).toThrow(AdapterError);
            expect(isPortOrDefault(value)).toBe(false);
        }
    });
});

describe("a plain host", () => {
    it("takes names, addresses and an IPv6 address in brackets", () => {
        for (const host of ["db.example.com", "10.0.0.5", "fb_5", "[2001:db8::1]", "[fe80::1%eth0]", " padded.example.com "]) {
            expect(plainHostProblem(host)).toBeNull();
        }
    });

    it("refuses what a program would read as an option, another host or another path", () => {
        for (const host of ["", "  ", "-oProxyCommand=x", "a b", "a\nb", "a\0b", "user@host", "host:22", "evil/srv", "a\\b", "2001:db8::1", "[a]b", 42]) {
            expect(plainHostProblem(host)).not.toBeNull();
        }
    });
});

describe("the host of a Firebird connection string", () => {
    const config = { host: "fb.example.com", port: 3050 };

    it("builds host[/port]:path for a plain host", () => {
        expect(buildConnectionString(config as never, "/data/shop.fdb")).toBe("fb.example.com:/data/shop.fdb");
        expect(buildConnectionString({ ...config, port: "3051" } as never, "/data/shop.fdb")).toBe("fb.example.com/3051:/data/shop.fdb");
        expect(buildConnectionString({ ...config, host: "[2001:db8::1]" } as never, "/data/shop.fdb")).toBe("[2001:db8::1]:/data/shop.fdb");
    });

    it("keeps a port typed into the host, which the client reads as the port", () => {
        expect(buildConnectionString({ ...config, host: "fb.example.com/3051" } as never, "/data/shop.fdb")).toBe("fb.example.com/3051:/data/shop.fdb");
    });

    it.each([
        ["an empty host, which names a file of the machine the tool runs on", ""],
        ["a missing host", undefined],
        ["a host with a path", "fb.example.com:/etc/passwd"],
        ["a host with a / of a path", "fb.example.com/srv"],
        ["a protocol of the client in front of a path with //", "inet"],
        ["another protocol", "XNET"],
        ["a host that reads as a switch", "-z"],
        ["a typed port out of range", "fb.example.com/70000"],
    ])("refuses %s", (_case, host) => {
        expect(() => buildConnectionString({ ...config, host } as never, "//other.example.com/shop.fdb")).toThrow(AdapterError);
        expect(firebirdHostProblem(host)).not.toBeNull();
    });

    it("refuses a stored port that is no port", () => {
        expect(() => buildConnectionString({ ...config, port: "3051:/etc" } as never, "/data/shop.fdb")).toThrow(AdapterError);
    });

    it("refuses such a host on save too", () => {
        const base = { user: "SYSDBA", databases: [{ name: "shop", path: "/data/shop.fdb" }] };
        expect(FirebirdSchema.safeParse({ ...base, host: "inet" }).success).toBe(false);
        expect(FirebirdSchema.safeParse({ ...base, host: "fb:/x" }).success).toBe(false);
        expect(FirebirdSchema.safeParse({ ...base, host: "fb.example.com" }).success).toBe(true);
        expect(FirebirdSchema.safeParse(base).success).toBe(true);
    });
});
