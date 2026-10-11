/**
 * The command line clients inside the database containers of the lab, logged in with the logins
 * of the catalog. Shell fragments for `sh -c` in the container, used to load the datasets and by
 * the lab tests to read what a restore wrote.
 */

import { DATABASE_LOGINS } from "./catalog";

const mysqlLogin = `-uroot -p'${DATABASE_LOGINS.mysql.password}'`;

/** The MariaDB client where the image has it, the MySQL client otherwise. */
export const mysqlClient = `$(command -v mariadb || command -v mysql) --default-character-set=utf8mb4 ${mysqlLogin}`;

export const mysqlDump = `$(command -v mariadb-dump || command -v mysqldump) --default-character-set=utf8mb4 ${mysqlLogin}`;

export const psql = `psql -U ${DATABASE_LOGINS.postgres.username}`;

export const pgDump = `pg_dump -U ${DATABASE_LOGINS.postgres.username}`;

/** mongosh from MongoDB 5 on, the old mongo shell before. */
export const mongoShell = `$(command -v mongosh || command -v mongo) --quiet -u ${DATABASE_LOGINS.mongodb.username} -p ${DATABASE_LOGINS.mongodb.password} --authenticationDatabase admin`;

/** The tools18 client of SQL Server 2019 and later, which checks certificates unless told not to, or the old one of 2017. */
export const sqlcmd = `$( [ -x /opt/mssql-tools18/bin/sqlcmd ] && echo '/opt/mssql-tools18/bin/sqlcmd -C' || echo /opt/mssql-tools/bin/sqlcmd ) -S localhost -U ${DATABASE_LOGINS.mssql.username} -P '${DATABASE_LOGINS.mssql.password}'`;

export const redisCli = `$(command -v valkey-cli || command -v redis-cli) -a ${DATABASE_LOGINS.redis.password} --no-auth-warning`;

export const isql = (database: string) => `isql -user ${DATABASE_LOGINS.firebird.username} -password ${DATABASE_LOGINS.firebird.password} -ch UTF8 ${database}`;
