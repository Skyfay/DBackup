import { ownDataRefusal } from "@/lib/adapters/own-data";

/**
 * Refuses a shared folder of SQL Server that reaches the own data of DBackup, the folder of its
 * database, of its TLS certificate or of the configuration backup, see `own-data.ts`. A run checks
 * it for everyone, a platform admin too, since a link may point there by now and a job of a member
 * may use a connection of a platform admin, like SQLite does for its file. The temporary folder of
 * DBackup stays allowed, since SQL Server only stages files with a random name of its own there.
 *
 * @throws Error with the sentence of the refusal.
 */
export async function assertSharedFolderOffOwnData(localBackupPath: string): Promise<void> {
    // The folder as the adapter uses it, in the shape `localPathOf` reads for a shared folder.
    const refusal = await ownDataRefusal("mssql", { localBackupPath });
    if (refusal) throw new Error(refusal);
}
