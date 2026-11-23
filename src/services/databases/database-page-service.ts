import { readDatabases, readJobs, readSources, readVersions, serverOf } from "./database-facts";
import type { DatabasePage, ServerBrief } from "./database-explorer-types";
import { pageOfDatabases, summarize, type DatabaseQuery } from "./database-list-model";

interface PageOptions {
    /** Whether the viewer may see jobs, which the coverage, the Job filter and the last backups need. */
    withJobs: boolean;
    /** Counts the tenants too, for the Tenant filter of All tenants. */
    byTenant?: boolean;
}

/**
 * One page of the Databases tab of the Database Explorer. The search, the filters with their counts
 * and the order need every database with its jobs and its last backup, which the list cache and
 * the newest run of each job tell. The servers with their versions and the jobs with their
 * schedules come only for the rows of the page, for their cells and the timeline.
 */
export async function listDatabasePage(query: DatabaseQuery, { withJobs, byTenant = false }: PageOptions): Promise<DatabasePage> {
    const [sources, jobs] = await Promise.all([readSources(), withJobs ? readJobs() : Promise.resolve(null)]);
    const databases = await readDatabases(sources, jobs);
    const serverList: ServerBrief[] = sources.map(({ listed: _listed, ...brief }) => brief);
    const { rows, total, facets } = pageOfDatabases(databases, serverList, withJobs, query, byTenant);

    const shown = new Set(rows.map((row) => row.serverId));
    const shownSources = sources.filter((source) => shown.has(source.id));
    const versions = await readVersions(shownSources.map((source) => source.id));
    const enabled = (jobs ?? []).filter((job) => job.enabled);
    const adapterOf = new Map(sources.map((source) => [source.id, source.adapterId]));

    return {
        rows,
        total,
        servers: shownSources.map((source) => serverOf(source, versions.get(source.id))),
        jobs: (jobs ?? []).filter((job) => shown.has(job.serverId)),
        coverage: withJobs,
        serverList,
        jobOptions: enabled.map((job) => ({ id: job.id, name: job.name })),
        facets,
        summary: summarize({ databases, servers: sources }),
        enabledJobs: enabled.length,
        keyStores: [...new Set(databases.filter((database) => database.kind === "instance").map((database) => adapterOf.get(database.serverId) ?? ""))],
    };
}
