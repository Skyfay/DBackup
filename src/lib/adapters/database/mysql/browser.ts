import { MySQLConfig } from "@/lib/adapters/definitions";
import { TableInfo, ColumnInfo, TableDataOptions, TableDataResult } from "@/lib/core/interfaces";
import {
    SshClient,
    isSSHMode,
    extractSshConfig,
    buildMysqlArgs,
    withLocalMyCnf,
    withRemoteMyCnf,
    remoteBinaryCheck,
    shellEscape,
} from "@/lib/ssh";
import { getMysqlCommand } from "./tools";
import { execFileAsync } from "./connection";

/** Sanitize a MySQL identifier (database/table/column name) for use in backtick-quoted SQL. */
function escapeMysqlIdentifier(name: string): string {
    return name.replace(/`/g, "``").replace(/\0/g, "");
}

const tablesQuery = (db: string) => `
    SELECT TABLE_NAME, TABLE_TYPE, TABLE_ROWS, COALESCE(DATA_LENGTH + INDEX_LENGTH, 0)
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = '${escapeMysqlIdentifier(db).replace(/'/g, "\\'")}'
    ORDER BY TABLE_NAME
`.trim();

const columnsQuery = (db: string, table: string) => `
    SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = '${escapeMysqlIdentifier(db).replace(/'/g, "\\'")}' AND TABLE_NAME = '${escapeMysqlIdentifier(table).replace(/'/g, "\\'")}'
    ORDER BY ORDINAL_POSITION
`.trim();

function parseTablesOutput(stdout: string): TableInfo[] {
    return stdout
        .split("\n")
        .map(l => l.trim())
        .filter(Boolean)
        .map(line => {
            const [name, rawType, rowCountStr, sizeStr] = line.split("\t");
            const type: TableInfo["type"] =
                rawType === "VIEW" ? "view" :
                rawType === "BASE TABLE" ? "table" : "table";
            return {
                name,
                type,
                rowCount: parseInt(rowCountStr, 10) || 0,
                sizeInBytes: parseInt(sizeStr, 10) || 0,
            };
        });
}

function parseColumnsOutput(stdout: string): ColumnInfo[] {
    return stdout
        .split("\n")
        .map(l => l.trim())
        .filter(Boolean)
        .map(line => {
            const [name, dataType, isNullable, columnKey, defaultValue] = line.split("\t");
            return {
                name,
                dataType,
                nullable: isNullable === "YES",
                primaryKey: columnKey === "PRI",
                defaultValue: defaultValue === "\\N" ? undefined : defaultValue,
            };
        });
}

function parseDataRows(
    stdout: string,
    columns: ColumnInfo[]
): Record<string, unknown>[] {
    return stdout
        .split("\n")
        .map(l => l.trim())
        .filter(Boolean)
        .map(line => {
            const values = line.split("\t");
            const row: Record<string, unknown> = {};
            columns.forEach((col, i) => {
                const raw = values[i];
                row[col.name] = raw === "\\N" || raw === undefined ? null : raw;
            });
            return row;
        });
}

export async function getTables(config: MySQLConfig, database: string): Promise<TableInfo[]> {
    const query = tablesQuery(database);

    if (isSSHMode(config)) {
        const ssh = new SshClient();
        try {
            await ssh.connect(extractSshConfig(config)!);
            const mysqlBin = await remoteBinaryCheck(ssh, "mariadb", "mysql");
            const args = buildMysqlArgs(config);

            return await withRemoteMyCnf(ssh, config.password, async (cnfPath) => {
                const prefix = cnfPath ? `--defaults-file=${shellEscape(cnfPath)} ` : "";
                const cmd = `${mysqlBin} ${prefix}${args.join(" ")} -e ${shellEscape(query)} --skip-column-names --batch`;
                const result = await ssh.exec(cmd);
                if (result.code !== 0) {
                    throw new Error(`Failed to list tables: ${result.stderr}`);
                }
                return parseTablesOutput(result.stdout);
            });
        } finally {
            ssh.end();
        }
    }

    const baseArgs = ["-h", config.host, "-P", String(config.port), "-u", config.user, "--protocol=tcp"];
    if (config.disableSsl) baseArgs.push("--skip-ssl");
    baseArgs.push("-e", query, "--skip-column-names", "--batch");

    return withLocalMyCnf(config.password, async (cnfPath) => {
        const args = cnfPath ? [`--defaults-file=${cnfPath}`, ...baseArgs] : baseArgs;
        const { stdout } = await execFileAsync(getMysqlCommand(), args);
        return parseTablesOutput(stdout);
    });
}

export async function getTableData(
    config: MySQLConfig,
    options: TableDataOptions
): Promise<TableDataResult> {
    const { database, table, page, pageSize } = options;
    const offset = (page - 1) * pageSize;
    const dbId = escapeMysqlIdentifier(database);
    const tblId = escapeMysqlIdentifier(table);
    const countQuery = `SELECT COUNT(*) FROM \`${dbId}\`.\`${tblId}\``;
    const dataQuery = `SELECT * FROM \`${dbId}\`.\`${tblId}\` LIMIT ${pageSize} OFFSET ${offset}`;
    const colQuery = columnsQuery(database, table);

    if (isSSHMode(config)) {
        const ssh = new SshClient();
        try {
            await ssh.connect(extractSshConfig(config)!);
            const mysqlBin = await remoteBinaryCheck(ssh, "mariadb", "mysql");
            const args = buildMysqlArgs(config);

            return await withRemoteMyCnf(ssh, config.password, async (cnfPath) => {
                const prefix = cnfPath ? `--defaults-file=${shellEscape(cnfPath)} ` : "";
                const base = `${mysqlBin} ${prefix}${args.join(" ")} --skip-column-names --batch`;

                const [colResult, countResult, dataResult] = await Promise.all([
                    ssh.exec(`${base} -e ${shellEscape(colQuery)}`),
                    ssh.exec(`${base} -e ${shellEscape(countQuery)}`),
                    ssh.exec(`${base} -e ${shellEscape(dataQuery)}`),
                ]);

                if (colResult.code !== 0) throw new Error(`Column query failed: ${colResult.stderr}`);
                if (countResult.code !== 0) throw new Error(`Count query failed: ${countResult.stderr}`);
                if (dataResult.code !== 0) throw new Error(`Data query failed: ${dataResult.stderr}`);

                const columns = parseColumnsOutput(colResult.stdout);
                const totalCount = parseInt(countResult.stdout.trim(), 10) || 0;
                const rows = parseDataRows(dataResult.stdout, columns);

                return { rows, totalCount, columns };
            });
        } finally {
            ssh.end();
        }
    }

    const baseArgs = ["-h", config.host, "-P", String(config.port), "-u", config.user, "--protocol=tcp"];
    if (config.disableSsl) baseArgs.push("--skip-ssl");

    return withLocalMyCnf(config.password, async (cnfPath) => {
        const cnfPrefix = cnfPath ? [`--defaults-file=${cnfPath}`] : [];
        const base = [...cnfPrefix, ...baseArgs, "--skip-column-names", "--batch"];

        const [colOut, countOut, dataOut] = await Promise.all([
            execFileAsync(getMysqlCommand(), [...base, "-e", colQuery]),
            execFileAsync(getMysqlCommand(), [...base, "-e", countQuery]),
            execFileAsync(getMysqlCommand(), [...base, "-e", dataQuery]),
        ]);

        const columns = parseColumnsOutput(colOut.stdout);
        const totalCount = parseInt(countOut.stdout.trim(), 10) || 0;
        const rows = parseDataRows(dataOut.stdout, columns);

        return { rows, totalCount, columns };
    });
}
