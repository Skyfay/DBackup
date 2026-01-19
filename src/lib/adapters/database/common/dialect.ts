export interface DatabaseDialect {
    /**
     * Generate arguments for the dump command
     */
    getDumpArgs(config: any, databases: string[]): string[];

    /**
     * Generate arguments for the restore command
     * @param targetDatabase - The specific target database name for this restore operation (if applicable)
     */
    getRestoreArgs(config: any, targetDatabase?: string): string[];

    /**
     * CLI specific flags for authentication/connection (e.g. --skip-ssl vs --ssl-mode=DISABLED)
     */
    getConnectionArgs(config: any): string[];

    /**
     * Determines if this dialect handles the given version string
     */
    supportsVersion(version: string): boolean;
}

export abstract class BaseDialect implements DatabaseDialect {
    abstract getDumpArgs(config: any, databases: string[]): string[];
    abstract getRestoreArgs(config: any, targetDatabase?: string): string[];
    abstract getConnectionArgs(config: any): string[];

    supportsVersion(version: string): boolean {
        return true; // Default fallback
    }

    protected appendAuthArgs(args: string[], config: any) {
        // Implementation provided by subclasses or specific common logic
    }
}
