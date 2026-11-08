/**
 * SQL Server 2017 to 2022. It writes its backups into a folder of the Docker host, which DBackup
 * reads directly on this machine and fetches over SSH from a remote host.
 */

import { isThisMachine, type LabConfig } from "../config";
import { localMssqlBackupDir } from "../folders";
import { shopCopy, viaFile, type Clients, type EngineSpec, type Run } from "./types";

/** Where SQL Server writes its .bak files on a remote Docker host, the same path in the container. */
export const MSSQL_BACKUP_DIR_REMOTE = "/srv/dbackup-lab/mssql";

/** Where SQL Server writes its backups on the Docker host of the lab. */
export function mssqlBackupDir(lab: LabConfig): string {
    return isThisMachine(lab.docker) ? localMssqlBackupDir(lab) : MSSQL_BACKUP_DIR_REMOTE;
}

const login = { username: "sa", password: "YourStrong!Passw0rd" };

/** The tools18 client of 2019 and later, which checks certificates unless told not to, or the old one of 2017. */
const clients: Clients = {
    cli: `$( [ -x /opt/mssql-tools18/bin/sqlcmd ] && echo '/opt/mssql-tools18/bin/sqlcmd -C' || echo /opt/mssql-tools/bin/sqlcmd ) -S localhost -U ${login.username} -P '${login.password}'`,
};

/** Row counts and checksums of every table, then every object and the code of each module. */
const fingerprintScript = (name: string) => `
SET NOCOUNT ON;
USE [${name}];
DECLARE @sql nvarchar(max);
SELECT @sql = STRING_AGG(CAST(N'SELECT ''' + s.name + N'.' + t.name + N''' AS name, COUNT_BIG(*) AS n, CHECKSUM_AGG(BINARY_CHECKSUM(*)) AS c FROM ' + QUOTENAME(s.name) + N'.' + QUOTENAME(t.name) AS nvarchar(max)), N' UNION ALL ')
    FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id;
SET @sql = N'SELECT * FROM (' + @sql + N') AS tables ORDER BY name';
EXEC sp_executesql @sql;
SELECT o.type, o.name FROM sys.objects o WHERE o.is_ms_shipped = 0 ORDER BY o.type, o.name;
SELECT OBJECT_NAME(m.object_id), m.definition FROM sys.sql_modules m ORDER BY 1;
GO
`;

const dropScript = (name: string) => `
IF DB_ID('${name}') IS NOT NULL
BEGIN
    ALTER DATABASE [${name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    DROP DATABASE [${name}];
END
GO
`;

export const MSSQL: EngineSpec = {
    id: "mssql",
    name: "SQL Server",
    versions: [
        { version: "2017", service: "mssql-2017", port: 14317, profile: "core" },
        { version: "2019", service: "mssql-2019", port: 14319, profile: "full" },
        { version: "2022", service: "mssql-2022", port: 14322, profile: "core" },
    ],
    innerPort: 1433,
    login,
    clients,
    dataset: {
        file: "mssql.sql",
        check: `${clients.cli} -h -1 -W -Q "SET NOCOUNT ON; SELECT name FROM sys.databases WHERE name = 'inventory'"`,
        // sqlcmd reads a file, not its standard input.
        load: `cat > /tmp/lab-dataset.sql && ${clients.cli} -b -i /tmp/lab-dataset.sql`,
    },
    source: (target, lab, where = "host") => {
        const base = { host: target.host, port: target.port, connectionMode: "direct", encrypt: true, trustServerCertificate: true };
        // DBackup in the network of the lab mounts the folder under the same path, like on this machine.
        if (where === "network" || isThisMachine(lab.docker)) {
            const folder = mssqlBackupDir(lab);
            return { ...base, backupPath: folder, fileTransferMode: "local", localBackupPath: folder };
        }
        // The seed adds the SSH login of the Docker host for these.
        return { ...base, backupPath: MSSQL_BACKUP_DIR_REMOTE, fileTransferMode: "ssh", sshHost: lab.docker.address, sshPort: lab.docker.ssh?.port ?? 22 };
    },
    restores: true,
    database: { name: "shop", location: "shop", restoreAs: shopCopy },
    fingerprint: (run: Run, database: string, tools: Clients) => viaFile(run, (file) => `${tools.cli} -b -h -1 -W -i ${file}`, fingerprintScript(database)),
    drop: async (run: Run, database: string, tools: Clients) => {
        await viaFile(run, (file) => `${tools.cli} -b -i ${file}`, dropScript(database));
    },
};
