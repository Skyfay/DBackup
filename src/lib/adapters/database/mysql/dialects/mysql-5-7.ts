import { MySQLBaseDialect } from "./mysql-base";
import type { ExecutionHost } from "@/lib/transport";
import type { DumpClient } from "../dump-content";
import { MySQLConfig } from "@/lib/adapters/definitions";

export class MySQL57Dialect extends MySQLBaseDialect {
    supportsVersion(version: string): boolean {
        return version.includes('5.7.') || (parseFloat(version) >= 5.7 && parseFloat(version) < 8.0);
    }

    getDumpArgs(config: MySQLConfig, databases: string[], host?: ExecutionHost, client?: DumpClient): string[] {
        const args = super.getDumpArgs(config, databases, host, client);

        // MySQL 5.7 specific handling for utf8mb4 (if needed)
        // or avoiding keywords that are new in 8.0

        // Example: 5.7 might not support some JSON flags or new auth plugins
        // For now, we keep it close to base, but separated for future fixes.

        return args;
    }
}
