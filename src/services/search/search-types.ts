/**
 * What the global search finds on the server, shared by its service, its route and the search in
 * the header. Plain data, so the browser can import it without the service behind it.
 */

/** Shorter than this finds too much to be of use. */
export const MIN_QUERY_LENGTH = 2;

/** Hits per kind, the first ones in the order of their names. */
export const PER_KIND = 5;

/** The connections the viewer may see, by the type of their adapter. */
export type ConnectionType = "database" | "storage" | "notification";

/** The kinds of templates, named like the tabs of the Templates page. */
export type TemplateKind = "retention" | "naming" | "schedules" | "notifications" | "excludes";

/** Which kinds a search may find, from the permissions of the viewer, each like the page that lists it. */
export interface SearchScope {
    jobs: boolean;
    /** The backups of a job by its name, like the Backups page lists them. */
    backups: boolean;
    runs: boolean;
    databases: boolean;
    connections: ConnectionType[];
    users: boolean;
    groups: boolean;
    apiKeys: boolean;
    templates: boolean;
    /** The encryption keys of the Vault. */
    keys: boolean;
    /** The saved logins of the Vault, which need the Vault and the credentials. */
    credentials: boolean;
}

/**
 * The tenant a hit belongs to. A platform admin in All tenants searches every tenant, and a hit opens
 * in its tenant. People belong to the whole instance and carry none.
 */
interface InTenant {
    tenantId?: string;
}

export type SearchHit =
    | ({ kind: "job"; id: string; name: string; enabled: boolean; schedule: string; adapterId: string | null; lastStatus: string | null } & InTenant)
    | ({ kind: "backups"; jobId: string; name: string } & InTenant)
    | ({ kind: "connection"; id: string; name: string; adapterId: string; type: string; storageRole: string | null; status: string } & InTenant)
    | ({ kind: "database"; serverId: string; serverName: string; adapterId: string; name: string; sizeInBytes: number | null } & InTenant)
    | ({ kind: "run"; id: string; name: string; status: string; startedAt: string; adapterId: string | null } & InTenant)
    /** `group` is the group in the tenant searched. In All tenants `tenants` counts the tenants of the account instead. */
    | { kind: "user"; id: string; name: string; email: string; group: string | null; tenants?: number }
    | ({ kind: "group"; id: string; name: string; people: number } & InTenant)
    | ({ kind: "apiKey"; id: string; name: string; prefix: string; owner: string; enabled: boolean; expired: boolean } & InTenant)
    /** `detail` is the pattern of a file name, the cron of a schedule and the description of the others. */
    | ({ kind: "template"; id: string; name: string; template: TemplateKind; detail: string | null } & InTenant)
    | ({ kind: "key"; id: string; name: string; jobs: number } & InTenant)
    | ({ kind: "credential"; id: string; name: string; type: string } & InTenant);
