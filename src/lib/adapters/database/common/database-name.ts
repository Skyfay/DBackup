/**
 * A database name as the tools take it: a value, never an option. A name from a job, a restore
 * target or a mapping, or one a server lists, reaches mysqldump, mongodump or mongorestore as an
 * argument of its own, where one that starts with `-` would be read as an option. So no name
 * starts with `-`, checked where a job or a restore takes it and again where an adapter passes it.
 * A plain module, the services and the adapters read it.
 */

/** Why a name cannot be a database name of DBackup, null when it can. */
export function databaseNameProblem(name: unknown): string | null {
    if (typeof name !== "string") return "A database name must be text.";
    if (name.startsWith("-")) return `The database name ${name} starts with -, which a database tool would read as an option.`;
    return null;
}

/** Throws for a name an adapter is about to pass as an argument, see `databaseNameProblem`. */
export function assertDatabaseArgument(name: string): string {
    const problem = databaseNameProblem(name);
    if (problem) throw new Error(problem);
    return name;
}
