import { describe, it, expect } from "vitest";
import { databaseDownloadFileName, databaseDumpFileName, safeNameSegment } from "@/lib/archive/dump-names";

describe("dump filenames derived from database names", () => {
    it("leaves an ordinary database name untouched", () => {
        expect(databaseDumpFileName("shop_prod", "sql")).toBe("shop_prod.sql");
        expect(databaseDumpFileName("shop-prod.v2", "custom")).toBe("shop-prod.v2.dump");
    });

    it("flattens a name that would otherwise climb out of its folder", () => {
        expect(safeNameSegment("../../etc/passwd")).toBe("_._.._etc_passwd");
        expect(safeNameSegment("..")).toBe("_.");
        expect(safeNameSegment("C:\\data\\x.fdb")).toBe("C:_data_x.fdb");
    });

    it("turns a Firebird alias that is a full path into one segment", () => {
        expect(databaseDumpFileName("/var/lib/firebird/data/employee.fdb", "fbk")).toBe("_var_lib_firebird_data_employee.fdb.fbk");
    });

    it("strips control characters and never returns an empty name", () => {
        expect(safeNameSegment("a\u0000b\nc")).toBe("a_b_c");
        expect(safeNameSegment("")).toBe("_");
    });

    it("uses the extension of every dump format", () => {
        expect(databaseDumpFileName("db", "bacpac")).toBe("db.bacpac");
        expect(databaseDumpFileName("dump", "rdb")).toBe("dump.rdb");
        expect(databaseDumpFileName("app.sqlite", "sqlite")).toBe("app.sqlite.sqlite");
    });

    it("names a downloaded dump after the backup it came from", () => {
        expect(databaseDownloadFileName("jobs/nightly_2026-09-16.tar", "shop", "sql")).toBe("nightly_2026-09-16_shop.sql");
        expect(databaseDownloadFileName("chain-2026/inc-2.tar", "../x", "custom")).toBe("inc-2__._x.dump");
    });
});
