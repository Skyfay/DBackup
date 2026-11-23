import { describe, it, expect } from "vitest";
import { dumpsOwnRoutines, parseShowCreate, readRoutines, routinesSql, unescapeBatchValue, type RoutineDefinition } from "@/lib/adapters/database/mysql/routines";
import type { DumpClient } from "@/lib/adapters/database/mysql/dump-content";
import type { MySQLConfig } from "@/lib/adapters/definitions";
import { clientHost, statements } from "./client-help";

const MARIADB_TOOL: DumpClient = { mariadb: true, setsGtidPurged: false, sslOff: "--skip-ssl" };
const MYSQL_TOOL: DumpClient = { mariadb: false, setsGtidPurged: true, sslOff: "--ssl-mode=DISABLED" };

const config = { host: "db.internal", port: 3306, user: "backup", database: "shop" } as unknown as MySQLConfig;

const FUNCTION_ROW = ["shipping", "ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES", "CREATE DEFINER=`root`@`%` FUNCTION `shipping`(w INT) RETURNS int\\n    DETERMINISTIC\\nRETURN w * 2", "utf8mb4", "utf8mb4_0900_ai_ci", "utf8mb4_unicode_ci"].join("\t");
const PROCEDURE_ROW = ["mark_paid", "", "CREATE DEFINER=`root`@`%` PROCEDURE `mark_paid`(IN order_id INT)\\nBEGIN\\n\\tUPDATE orders SET note = 'a\\\\b' WHERE id = order_id;\\nEND", "utf8mb4", "utf8mb4_0900_ai_ci", "utf8mb4_unicode_ci"].join("\t");

describe("when DBackup writes the routines of a MySQL server itself", () => {
    it("takes over for MySQL 26 and later behind MariaDB's dump tool, which asks those servers for packages", () => {
        expect(dumpsOwnRoutines({ detectedVersion: "26.10.0" }, MARIADB_TOOL)).toBe(true);
        expect(dumpsOwnRoutines({ type: "mysql", detectedVersion: "27.4.1" }, MARIADB_TOOL)).toBe(true);
    });

    it("leaves MySQL 9 and older, MariaDB servers and MySQL's own mysqldump to the dump tool", () => {
        expect(dumpsOwnRoutines({ detectedVersion: "9.7.4" }, MARIADB_TOOL)).toBe(false);
        expect(dumpsOwnRoutines({ detectedVersion: "8.0.44" }, MARIADB_TOOL)).toBe(false);
        expect(dumpsOwnRoutines({ detectedVersion: "26.10.0" }, MYSQL_TOOL)).toBe(false);
        expect(dumpsOwnRoutines({ detectedVersion: "11.8.3-MariaDB" }, MARIADB_TOOL)).toBe(false);
        expect(dumpsOwnRoutines({ type: "mariadb", detectedVersion: "11.8.3" }, MARIADB_TOOL)).toBe(false);
        expect(dumpsOwnRoutines({}, MARIADB_TOOL)).toBe(false);
    });

    it("leaves a MariaDB 10 or 11 behind a connection of the type MySQL to the dump tool, whose kept version lost its suffix", () => {
        expect(dumpsOwnRoutines({ type: "mysql", detectedVersion: "10.11.9" }, MARIADB_TOOL)).toBe(false);
        expect(dumpsOwnRoutines({ type: "mysql", detectedVersion: "11.8.3" }, MARIADB_TOOL)).toBe(false);
    });
});

describe("the batch output of the client", () => {
    it("reads a tab, a line break, a NUL and a backslash back from their escapes", () => {
        expect(unescapeBatchValue("a\\tb\\nc\\0d\\\\e")).toBe("a\tb\nc\0d\\e");
        expect(unescapeBatchValue("C:\\\\new")).toBe("C:\\new");
    });

    it("gives every routine its type in the order it was asked", () => {
        const routines = parseShowCreate(`${FUNCTION_ROW}\n${PROCEDURE_ROW}\n`, [{ type: "FUNCTION" }, { type: "PROCEDURE" }]);

        expect(routines.map((routine) => [routine.type, routine.name])).toEqual([["FUNCTION", "shipping"], ["PROCEDURE", "mark_paid"]]);
        expect(routines[0].create).toBe("CREATE DEFINER=`root`@`%` FUNCTION `shipping`(w INT) RETURNS int\n    DETERMINISTIC\nRETURN w * 2");
        expect(routines[1].create).toContain("\tUPDATE orders SET note = 'a\\b'");
        expect(routines[1].sqlMode).toBe("");
    });

    it("fails when a definition is missing rather than writing a dump without it", () => {
        expect(() => parseShowCreate(`${FUNCTION_ROW}\n`, [{ type: "FUNCTION" }, { type: "PROCEDURE" }])).toThrow(/Expected 2 routine definitions/);
        expect(() => parseShowCreate("secret\tSTRICT_TRANS_TABLES\tNULL\tutf8mb4\tutf8mb4_0900_ai_ci\tutf8mb4_unicode_ci\n", [{ type: "FUNCTION" }])).toThrow(/may not read the definition of function secret/);
    });
});

describe("the routines at the end of a dump", () => {
    const routine: RoutineDefinition = {
        type: "FUNCTION",
        name: "ship`ping",
        sqlMode: "STRICT_TRANS_TABLES",
        create: "CREATE FUNCTION `ship``ping`() RETURNS int\nRETURN 1",
        charsetClient: "utf8mb4",
        collationConnection: "utf8mb4_0900_ai_ci",
    };

    it("writes each routine like mysqldump does, with its SQL mode and character set around it", () => {
        const sql = routinesSql("shop", [routine]);

        expect(sql).toContain("-- Dumping routines for database 'shop'");
        expect(sql).toContain("DROP FUNCTION IF EXISTS `ship``ping`;");
        expect(sql).toContain("SET sql_mode = 'STRICT_TRANS_TABLES';");
        expect(sql).toContain("SET character_set_client = utf8mb4;");
        expect(sql).toContain("SET collation_connection = utf8mb4_0900_ai_ci;");
        expect(sql).toContain("DELIMITER ;;\nCREATE FUNCTION `ship``ping`() RETURNS int\nRETURN 1 ;;\nDELIMITER ;");
        expect(sql.indexOf("SET sql_mode = @saved_sql_mode;")).toBeGreaterThan(sql.indexOf("DELIMITER ;\n"));
        expect(sql).not.toContain("/*!");
    });

    it("leaves out a character set that is no plain word and quotes the SQL mode", () => {
        const sql = routinesSql("shop", [{ ...routine, charsetClient: "utf8mb4; DROP DATABASE shop", sqlMode: "it's" }]);

        expect(sql).not.toContain("DROP DATABASE");
        expect(sql).not.toContain("character_set_client");
        expect(sql).toContain("SET sql_mode = 'it''s';");
    });

    it("keeps a line break of the database name out of the comment", () => {
        expect(routinesSql("a\nDROP DATABASE b", [routine])).toContain("-- Dumping routines for database 'a DROP DATABASE b'");
    });

    it("adds nothing for a database without routines", () => {
        expect(routinesSql("shop", [])).toBe("");
    });
});

describe("reading the routines from the server", () => {
    it("lists them and reads their definitions in one call, with the shell commands of the client off", async () => {
        const host = clientHost({
            onExec: (argv) => {
                const sql = argv.at(-1) ?? "";
                if (sql.includes("information_schema.ROUTINES")) return { stdout: "FUNCTION\tshipping\nPROCEDURE\tmark_paid\n" };
                if (sql.startsWith("SHOW CREATE")) return { stdout: `${FUNCTION_ROW}\n${PROCEDURE_ROW}\n` };
                return undefined;
            },
        });

        const result = await readRoutines(config, "shop", host, []);

        expect(result.count).toBe(2);
        expect(result.sql).toContain("DROP FUNCTION IF EXISTS `shipping`;");
        expect(result.sql).toContain("DROP PROCEDURE IF EXISTS `mark_paid`;");
        const calls = statements(host);
        expect(calls).toHaveLength(2);
        expect(calls[1].at(-1)).toBe("SHOW CREATE FUNCTION `shipping`; SHOW CREATE PROCEDURE `mark_paid`");
        for (const argv of calls) {
            expect(argv).toEqual(expect.arrayContaining(["--local-infile=0", "--default-character-set=utf8mb4", "--sandbox", "--database=shop"]));
        }
    });

    it("quotes a backtick in the name of a routine", async () => {
        const host = clientHost({
            onExec: (argv) => {
                const sql = argv.at(-1) ?? "";
                if (sql.includes("information_schema.ROUTINES")) return { stdout: "PROCEDURE\ta`b\n" };
                if (sql.startsWith("SHOW CREATE")) return { stdout: "a`b\t\tCREATE PROCEDURE `a``b`() SELECT 1\tutf8mb4\tutf8mb4_0900_ai_ci\tutf8mb4_unicode_ci\n" };
                return undefined;
            },
        });

        await readRoutines(config, "shop", host, []);

        expect(statements(host)[1].at(-1)).toBe("SHOW CREATE PROCEDURE `a``b`");
    });

    it("asks nothing more for a database without routines", async () => {
        const host = clientHost({ onExec: () => ({ stdout: "" }) });

        expect(await readRoutines(config, "shop", host, [])).toEqual({ sql: "", count: 0 });
        expect(statements(host)).toHaveLength(1);
    });

    it("fails with the words of the client when it cannot read them", async () => {
        const host = clientHost({
            onExec: (argv) => (argv.at(-1)?.includes("information_schema.ROUTINES") ? { code: 1, stderr: "ERROR 2013 (HY000): Lost connection to server" } : undefined),
        });

        await expect(readRoutines(config, "shop", host, [])).rejects.toThrow(/Reading the stored procedures and functions of shop failed: ERROR 2013/);
    });
});
