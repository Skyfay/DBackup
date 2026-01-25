# Supported Database Versions

This document outlines the database engines and versions supported by the Database Backup Manager. Support is determined by the client tools installed in the Docker container and the dialect implementations in the codebase.

| Database Engine | Supported Versions | Notes |
| :--- | :--- | :--- |
| **PostgreSQL** | 12, 13, 14, 15, 16, 17, 18 | Uses `pg_dump` from `postgresql18-client` (Alpine Linux). Backward compatible with older server versions. |
| **MySQL** | 5.7, 8.0, 8.4, 9.0 | Uses `mariadb-client` (compatible with MySQL protocols). Tested with MySQL 8.x and 9.x. |
| **MariaDB** | 10.x, 11.x | Uses `mariadb-client` (Native support). |
| **MongoDB** | 4.x, 5.x, 6.x, 7.x, 8.x | Uses `mongodb-tools` (v100.x). Supports standard `mongodump` operations. |
| **SQLite** | 3.x | Supports local files and remote SSH backups (`sqlite3 .dump`). |

## Technical Details

The application uses the following client tools inside the Docker container (Alpine Linux):

*   **MySQL / MariaDB**: `mysql-client` (MariaDB 11.4.9-r0 or newer). This client is highly compatible with upstream MySQL servers.
*   **PostgreSQL**: `postgresql18-client` (v18.1 or newer). `pg_dump` is generally backward compatible, allowing backups of older server versions (typically back to supported LTS versions).
*   **MongoDB**: `mongodb-tools` (v100.13.0 or newer). Contains `mongodump` and `mongorestore`.
*   **SQLite**: `sqlite` (v3.x). Used for local operations and integrity checks. For remote SSH backups, the target server must have `sqlite3` installed.

## Dialect Support

The system uses a "Dialect" pattern to handle version-specific implementation details (e.g., deprecated flags, system table differences).

*   **MySQL Dialects**:
    *   `mysql:5.7`: Handles legacy password column names in user tables.
    *   `mysql:8`: Supports modern role management and component references.
    *   `mariadb:10`: Specifics for MariaDB 10.x series.
*   **PostgreSQL Dialects**:
    *   `postgres:default`: Generic dialect handling standard operations via `pg_dump`.
*   **MongoDB**:
    *   Generic support via standard tools (no version-specific dialects needed currently).
