import { MySQLBaseDialect } from "./mysql-base";
import { MySQL80Dialect } from "./mysql-8";
import { MySQL57Dialect } from "./mysql-5-7";
import { MariaDBDialect } from "./mariadb";
import { compareVersions } from "@/lib/utils";

export function getDialect(adapterId: string, version?: string): MySQLBaseDialect {
    // 1. Explicit MariaDB Adapter Check
    if (adapterId === 'mariadb') {
        return new MariaDBDialect(); // Could be extended for MariaDB 10 vs 11
    }

    // 2. MySQL Version Check
    if (version) {
        const lowerV = version.toLowerCase();

        // Check for MariaDB even if adapterId is 'mysql' (e.g. user selected wrong type)
        if (lowerV.includes('mariadb')) {
            return new MariaDBDialect();
        }

        // MySQL before 5.5.3 predates utf8mb4, so the 8.0 dialect's charset flag
        // makes the dump fail outright. Such servers get the plain base flags.
        // This is not a support promise for 5.1 or 5.5, the documented minimum
        // stays 5.7. compareVersions returns 0 for an empty string, so an
        // unparseable version still falls through to the 8.0 default below.
        if (compareVersions(lowerV, '5.5.3') < 0) {
            return new MySQLBaseDialect();
        }

        // MySQL 5.7
        if (lowerV.includes('5.7.')) {
            return new MySQL57Dialect();
        }

        // MySQL 8+
        // Fallthrough to default
    }

    // Default for 'mysql' adapter is MySQL 8
    // Default fallback is Base/8
    return new MySQL80Dialect();
}
