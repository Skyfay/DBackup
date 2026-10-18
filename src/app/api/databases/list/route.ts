import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { checkPermissionWithContext, getAuthContext, hasPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PermissionError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { DATABASE_SORTS } from "@/services/databases/database-explorer-types";
import { DATABASE_MAX_PAGE_SIZE } from "@/services/databases/database-list-model";
import { listDatabasePage } from "@/services/databases/database-page-service";

const log = logger.child({ route: "databases/list" });

const QuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(DATABASE_MAX_PAGE_SIZE).default(25),
    sort: z.enum(DATABASE_SORTS).default("size"),
    order: z.enum(["asc", "desc"]).default("desc"),
    search: z.string().max(200).optional(),
    server: z.array(z.string().min(1).max(200)).max(1000),
    engine: z.array(z.string().min(1).max(100)).max(50),
    job: z.array(z.string().min(1).max(200)).max(1000),
    state: z.array(z.enum(["backed-up", "no-job", "never", "unread"])).max(4),
    tenant: z.array(z.string().min(1).max(200)).max(500),
});

/**
 * GET /api/databases/list
 * One page of the databases of the Database Explorer, biggest first unless `sort` and `order` say
 * otherwise, with how many each value of a filter leaves, the numbers of every database and every
 * server for the filters. Filters may repeat to match any of their values: `server` (a connection
 * id), `engine` (like `postgres`), `job` (a job id, `none` for the databases in no job), `state` and
 * in All tenants `tenant`. The jobs, the Job filter and the last backups only for a viewer who may
 * see jobs.
 */
export async function GET(req: NextRequest) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.SOURCES.VIEW);
    } catch (error: unknown) {
        if (error instanceof PermissionError) return NextResponse.json({ success: false, error: error.message }, { status: 403 });
        throw error;
    }

    const params = req.nextUrl.searchParams;
    const parsed = QuerySchema.safeParse({
        page: params.get("page") ?? undefined,
        pageSize: params.get("pageSize") ?? undefined,
        sort: params.get("sort") ?? undefined,
        order: params.get("order") ?? undefined,
        search: params.get("search") ?? undefined,
        server: params.getAll("server"),
        engine: params.getAll("engine"),
        job: params.getAll("job"),
        state: params.getAll("state"),
        tenant: params.getAll("tenant"),
    });
    if (!parsed.success) return NextResponse.json({ success: false, error: "Invalid query parameters" }, { status: 400 });

    const query = parsed.data;
    try {
        const data = await listDatabasePage({
            page: query.page,
            pageSize: query.pageSize,
            sort: query.sort,
            desc: query.order === "desc",
            search: query.search,
            serverIds: query.server,
            engines: query.engine,
            jobIds: query.job,
            states: query.state,
            // The Tenant filter of All tenants. Inside a tenant every database is of that tenant anyway.
            tenantIds: ctx.allTenants ? query.tenant : [],
        }, { withJobs: hasPermissionWithContext(ctx, PERMISSIONS.JOBS.READ), byTenant: ctx.allTenants });
        return NextResponse.json({ success: true, data });
    } catch (error: unknown) {
        log.error("Failed to list the databases", {}, wrapError(error));
        return NextResponse.json({ success: false, error: "Failed to load the databases" }, { status: 500 });
    }
}
