import { describe, it, expect } from "vitest";
import { getDialect } from "@/lib/adapters/database/mysql/dialects/index";
import { MySQLBaseDialect } from "@/lib/adapters/database/mysql/dialects/mysql-base";
import { MySQL57Dialect } from "@/lib/adapters/database/mysql/dialects/mysql-5-7";
import { MySQL80Dialect } from "@/lib/adapters/database/mysql/dialects/mysql-8";
import { MariaDBDialect } from "@/lib/adapters/database/mysql/dialects/mariadb";
import type { MySQLConfig } from "@/lib/adapters/definitions";
import type { MariaDBConfig } from "@/lib/adapters/definitions";

const baseMySQLConfig: MySQLConfig = {
    host: "localhost",
    port: 3306,
    user: "root",
    database: "testdb",
    disableSsl: false,
    connectionMode: "direct",
};

const baseMariaDBConfig: MariaDBConfig = {
    host: "localhost",
    port: 3306,
    user: "root",
    database: "testdb",
    disableSsl: false,
    connectionMode: "direct",
};

// --- getDialect ---

describe("getDialect", () => {
    it("returns MariaDBDialect for adapterId 'mariadb' without version", () => {
        expect(getDialect("mariadb")).toBeInstanceOf(MariaDBDialect);
    });

    it("returns MariaDBDialect for adapterId 'mariadb' with a version string", () => {
        expect(getDialect("mariadb", "10.11.3-MariaDB")).toBeInstanceOf(MariaDBDialect);
    });

    it("returns MariaDBDialect when version contains 'mariadb' but adapterId is 'mysql'", () => {
        expect(getDialect("mysql", "5.5.5-10.6.4-MariaDB")).toBeInstanceOf(MariaDBDialect);
    });

    it("returns MySQL57Dialect when version contains '5.7.'", () => {
        expect(getDialect("mysql", "5.7.39")).toBeInstanceOf(MySQL57Dialect);
    });

    it("returns MySQL80Dialect as default for 'mysql' without version", () => {
        expect(getDialect("mysql")).toBeInstanceOf(MySQL80Dialect);
    });

    it("returns MySQL80Dialect for 'mysql' with an 8.x version string", () => {
        expect(getDialect("mysql", "8.0.33")).toBeInstanceOf(MySQL80Dialect);
    });

    it("returns MySQL80Dialect for unknown adapterId without version", () => {
        expect(getDialect("unknown")).toBeInstanceOf(MySQL80Dialect);
    });

    it("returns the base dialect for MySQL before 5.5.3", () => {
        // utf8mb4 arrived in 5.5.3, older servers must not get the 8.0 charset flag (#151).
        expect(getDialect("mysql", "5.1.66")).toBeInstanceOf(MySQLBaseDialect);
        expect(getDialect("mysql", "5.1.66")).not.toBeInstanceOf(MySQL80Dialect);
        expect(getDialect("mysql", "5.5.2")).not.toBeInstanceOf(MySQL80Dialect);
    });

    it("returns MySQL80Dialect for MySQL 5.5.3 up to 5.6", () => {
        expect(getDialect("mysql", "5.5.3")).toBeInstanceOf(MySQL80Dialect);
        expect(getDialect("mysql", "5.6.51")).toBeInstanceOf(MySQL80Dialect);
    });

    it("omits the charset flag from dump args for MySQL before 5.5.3", () => {
        const args = getDialect("mysql", "5.1.66").getDumpArgs(baseMySQLConfig, ["mydb"]);
        expect(args.some((a) => a.startsWith("--default-character-set"))).toBe(false);
        expect(args).toContain("--databases");
    });
});

// --- MySQLBaseDialect ---

describe("MySQLBaseDialect.getDumpArgs", () => {
    // MySQLBaseDialect is abstract in spirit but concrete enough to instantiate via subclass.
    // We use MySQL80Dialect (extends base) to verify base behavior where 8 doesn't override.
    // For getDumpArgs specifically, MySQL80Dialect adds extra flags so we test base directly
    // through a minimal concrete subclass.
    class ConcreteBase extends MySQLBaseDialect {}
    const dialect = new ConcreteBase();

    it("includes host, port, user and protocol flags", () => {
        const args = dialect.getDumpArgs(baseMySQLConfig, ["mydb"]);
        expect(args).toContain("-h");
        expect(args).toContain("localhost");
        expect(args).toContain("-P");
        expect(args).toContain("3306");
        expect(args).toContain("-u");
        expect(args).toContain("root");
        expect(args).toContain("--protocol=tcp");
        expect(args).toContain("--net-buffer-length=16384");
    });

    it("adds --databases flag for a single database", () => {
        const args = dialect.getDumpArgs(baseMySQLConfig, ["mydb"]);
        expect(args).toContain("--databases");
        expect(args).toContain("mydb");
    });

    it("does not add --databases flag when multiple databases are given (TAR path)", () => {
        const args = dialect.getDumpArgs(baseMySQLConfig, ["db1", "db2"]);
        expect(args).not.toContain("--databases");
    });

    it("appends custom options when provided", () => {
        const config: MySQLConfig = { ...baseMySQLConfig, options: "--single-transaction --quick" };
        const args = dialect.getDumpArgs(config, ["mydb"]);
        expect(args).toContain("--single-transaction");
        expect(args).toContain("--quick");
    });

    it("ignores empty option tokens from options string", () => {
        const config: MySQLConfig = { ...baseMySQLConfig, options: "  --single-transaction  " };
        const args = dialect.getDumpArgs(config, ["mydb"]);
        const count = args.filter((a) => a.trim() === "").length;
        expect(count).toBe(0);
    });

    it("does not add --skip-ssl when SSL is enabled", () => {
        const args = dialect.getDumpArgs(baseMySQLConfig, ["mydb"]);
        expect(args).not.toContain("--skip-ssl");
    });

    it("adds --skip-ssl when disableSsl is true", () => {
        const config: MySQLConfig = { ...baseMySQLConfig, disableSsl: true };
        const args = dialect.getDumpArgs(config, ["mydb"]);
        expect(args).toContain("--skip-ssl");
    });
});

describe("MySQLBaseDialect.getRestoreArgs", () => {
    class ConcreteBase extends MySQLBaseDialect {}
    const dialect = new ConcreteBase();

    it("includes host, port, user, protocol and max-allowed-packet", () => {
        const args = dialect.getRestoreArgs(baseMySQLConfig);
        expect(args).toContain("-h");
        expect(args).toContain("localhost");
        expect(args).toContain("-P");
        expect(args).toContain("3306");
        expect(args).toContain("--protocol=tcp");
        expect(args).toContain("--max-allowed-packet=64M");
    });

    it("does not include target database when not provided", () => {
        const args = dialect.getRestoreArgs(baseMySQLConfig);
        expect(args).not.toContain("targetdb");
    });

    it("appends target database when provided", () => {
        const args = dialect.getRestoreArgs(baseMySQLConfig, "targetdb");
        expect(args).toContain("targetdb");
    });

    it("adds --skip-ssl when disableSsl is true", () => {
        const config: MySQLConfig = { ...baseMySQLConfig, disableSsl: true };
        const args = dialect.getRestoreArgs(config);
        expect(args).toContain("--skip-ssl");
    });
});

describe("MySQLBaseDialect.getConnectionArgs", () => {
    class ConcreteBase extends MySQLBaseDialect {}
    const dialect = new ConcreteBase();

    it("includes host, port, user and protocol", () => {
        const args = dialect.getConnectionArgs(baseMySQLConfig);
        expect(args).toContain("-h");
        expect(args).toContain("localhost");
        expect(args).toContain("-P");
        expect(args).toContain("3306");
        expect(args).toContain("-u");
        expect(args).toContain("root");
        expect(args).toContain("--protocol=tcp");
    });

    it("adds --skip-ssl when disableSsl is true", () => {
        const config: MySQLConfig = { ...baseMySQLConfig, disableSsl: true };
        const args = dialect.getConnectionArgs(config);
        expect(args).toContain("--skip-ssl");
    });
});

// --- MySQL57Dialect ---

describe("MySQL57Dialect", () => {
    const dialect = new MySQL57Dialect();

    describe("supportsVersion", () => {
        it("returns true for a 5.7.x version string", () => {
            expect(dialect.supportsVersion("5.7.39")).toBe(true);
        });

        it("returns true for a version between 5.7 and 8.0 (e.g. 5.7)", () => {
            expect(dialect.supportsVersion("5.7")).toBe(true);
        });

        it("returns false for an 8.0.x version string", () => {
            expect(dialect.supportsVersion("8.0.33")).toBe(false);
        });

        it("returns false for a 5.6 version string", () => {
            expect(dialect.supportsVersion("5.6.50")).toBe(false);
        });
    });

    describe("getDumpArgs", () => {
        it("includes base flags", () => {
            const args = dialect.getDumpArgs(baseMySQLConfig, ["mydb"]);
            expect(args).toContain("--protocol=tcp");
            expect(args).toContain("--databases");
        });

        it("adds --ssl-mode=DISABLED when disableSsl is true", () => {
            const config: MySQLConfig = { ...baseMySQLConfig, disableSsl: true };
            const args = dialect.getDumpArgs(config, ["mydb"]);
            expect(args).toContain("--ssl-mode=DISABLED");
        });

        it("does not add --ssl-mode=DISABLED when SSL is enabled", () => {
            const args = dialect.getDumpArgs(baseMySQLConfig, ["mydb"]);
            expect(args).not.toContain("--ssl-mode=DISABLED");
        });
    });
});

// --- MySQL80Dialect ---

describe("MySQL80Dialect", () => {
    const dialect = new MySQL80Dialect();

    describe("supportsVersion", () => {
        it("returns true for 8.0.x", () => {
            expect(dialect.supportsVersion("8.0.33")).toBe(true);
        });

        it("returns true for versions >= 8.0", () => {
            expect(dialect.supportsVersion("8.1")).toBe(true);
        });

        it("returns false for 5.7.x", () => {
            expect(dialect.supportsVersion("5.7.39")).toBe(false);
        });
    });

    describe("getDumpArgs", () => {
        it("includes --default-character-set=utf8mb4", () => {
            const args = dialect.getDumpArgs(baseMySQLConfig, ["mydb"]);
            expect(args).toContain("--default-character-set=utf8mb4");
        });

        it("includes base flags alongside the charset flag", () => {
            const args = dialect.getDumpArgs(baseMySQLConfig, ["mydb"]);
            expect(args).toContain("--protocol=tcp");
            expect(args).toContain("--databases");
        });

        it("lets a --default-character-set in the options override utf8mb4", () => {
            const args = dialect.getDumpArgs(
                { ...baseMySQLConfig, options: "--default-character-set=utf8" },
                ["mydb"],
            );
            const charsetFlags = args.filter((a) => a.startsWith("--default-character-set"));
            expect(charsetFlags).toEqual(["--default-character-set=utf8"]);
        });
    });
});

// --- MariaDBDialect ---

describe("MariaDBDialect", () => {
    const dialect = new MariaDBDialect();

    describe("supportsVersion", () => {
        it("returns true when version string contains 'mariadb'", () => {
            expect(dialect.supportsVersion("10.6.4-MariaDB")).toBe(true);
        });

        it("returns true for versions >= 10.0 by float comparison", () => {
            expect(dialect.supportsVersion("10.0")).toBe(true);
        });

        it("returns false for a plain MySQL 8 version string", () => {
            expect(dialect.supportsVersion("8.0.33")).toBe(false);
        });
    });

    describe("getDumpArgs", () => {
        it("includes base flags inherited from MySQLBaseDialect", () => {
            const args = dialect.getDumpArgs(baseMariaDBConfig, ["mydb"]);
            expect(args).toContain("--protocol=tcp");
            expect(args).toContain("--databases");
            expect(args).toContain("mydb");
        });

        it("adds --skip-ssl when disableSsl is true", () => {
            const config: MariaDBConfig = { ...baseMariaDBConfig, disableSsl: true };
            const args = dialect.getDumpArgs(config, ["mydb"]);
            expect(args).toContain("--skip-ssl");
        });

        it("does not add --skip-ssl when SSL is enabled", () => {
            const args = dialect.getDumpArgs(baseMariaDBConfig, ["mydb"]);
            expect(args).not.toContain("--skip-ssl");
        });
    });
});
