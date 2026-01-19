import { MySQLBaseDialect } from "./mysql-base";

export class MariaDBDialect extends MySQLBaseDialect {
    supportsVersion(version: string): boolean {
        return version.toLowerCase().includes('mariadb') || parseFloat(version) >= 10.0;
    }

    protected appendAuthArgs(args: string[], config: any) {
        // MariaDB tools prefer --skip-ssl over --ssl-mode
        if (config.disableSsl) {
             args.push('--skip-ssl');
        }
    }

    getDumpArgs(config: any, databases: string[]): string[] {
        const args = super.getDumpArgs(config, databases);

        // MariaDB specific dump flags could be added here.
        // For example --sandbox or specific locking behavior.
        // For compatibility, we stick to the base flags for now.

        return args;
    }
}
