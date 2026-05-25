import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/ssh", () => ({
    SshClient: vi.fn(),
    isSSHMode: vi.fn(() => false),
    extractSshConfig: vi.fn(),
    buildPsqlArgs: vi.fn(() => []),
    remoteEnv: vi.fn((env: unknown, cmd: string) => cmd),
    remoteBinaryCheck: vi.fn(),
    shellEscape: vi.fn((s: string) => s),
}));

vi.mock("@/lib/adapters/database/postgres/connection", () => ({
    execFileAsync: vi.fn(),
}));

import { getTables, getTableData } from "@/lib/adapters/database/postgres/browser";
import { execFileAsync } from "@/lib/adapters/database/postgres/connection";

const baseConfig = {
    host: "localhost",
    port: 5432,
    user: "postgres",
    password: "secret",
    database: "testdb",
    sshEnabled: false,
};

describe("Postgres browser - getTables", () => {
    beforeEach(() => vi.clearAllMocks());

    it("returns parsed table list", async () => {
        vi.mocked(execFileAsync).mockResolvedValue({
            stdout: "orders\tBASE TABLE\t100\t204800\n",
            stderr: "",
        } as any);

        const result = await getTables(baseConfig as any, "testdb");

        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
            name: "orders",
            type: "table",
            rowCount: 100,
            sizeInBytes: 204800,
        });
    });

    it("maps VIEW type correctly", async () => {
        vi.mocked(execFileAsync).mockResolvedValue({
            stdout: "v_orders\tVIEW\t0\t0\n",
            stderr: "",
        } as any);

        const result = await getTables(baseConfig as any, "testdb");

        expect(result[0].type).toBe("view");
    });

    it("maps MATERIALIZED VIEW type correctly", async () => {
        vi.mocked(execFileAsync).mockResolvedValue({
            stdout: "mv_stats\tMATERIALIZED VIEW\t500\t65536\n",
            stderr: "",
        } as any);

        const result = await getTables(baseConfig as any, "testdb");

        expect(result[0].type).toBe("materialized_view");
    });

    it("returns empty array when output is blank", async () => {
        vi.mocked(execFileAsync).mockResolvedValue({ stdout: "", stderr: "" } as any);

        const result = await getTables(baseConfig as any, "testdb");

        expect(result).toEqual([]);
    });
});

describe("Postgres browser - getTableData", () => {
    beforeEach(() => vi.clearAllMocks());

    const options = {
        database: "testdb",
        table: "orders",
        page: 1,
        pageSize: 5,
    };

    it("returns rows, totalCount and columns", async () => {
        const colStdout = "id\tinteger\tNO\tPRI\t\nstatus\ttext\tYES\t\t\n";
        const countStdout = "2\n";
        const dataStdout = "1\tpending\n2\tshipped\n";

        vi.mocked(execFileAsync)
            .mockResolvedValueOnce({ stdout: colStdout, stderr: "" } as any)
            .mockResolvedValueOnce({ stdout: countStdout, stderr: "" } as any)
            .mockResolvedValueOnce({ stdout: dataStdout, stderr: "" } as any);

        const result = await getTableData(baseConfig as any, options as any);

        expect(result.totalCount).toBe(2);
        expect(result.columns).toHaveLength(2);
        expect(result.columns[0]).toMatchObject({ name: "id", primaryKey: true });
        expect(result.rows).toHaveLength(2);
        expect(result.rows[1]).toEqual({ id: "2", status: "shipped" });
    });

    it("keeps empty string column default as undefined", async () => {
        const colStdout = "code\ttext\tNO\t\t\n";
        vi.mocked(execFileAsync)
            .mockResolvedValueOnce({ stdout: colStdout, stderr: "" } as any)
            .mockResolvedValueOnce({ stdout: "0\n", stderr: "" } as any)
            .mockResolvedValueOnce({ stdout: "", stderr: "" } as any);

        const result = await getTableData(baseConfig as any, options as any);

        expect(result.columns[0].defaultValue).toBeUndefined();
    });

    it("handles search with 'starts' matchMode", async () => {
        vi.mocked(execFileAsync).mockResolvedValue({ stdout: "", stderr: "" } as any);

        await getTableData(baseConfig as any, {
            ...options,
            search: "ord",
            searchColumn: "status",
            matchMode: "starts",
        } as any);

        expect(execFileAsync).toHaveBeenCalled();
    });
});
