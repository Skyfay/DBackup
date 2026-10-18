import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { checkPermissionWithContext, getAuthContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PermissionError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { JOB_MAX_PAGE_SIZE, listJobPage } from "@/services/jobs/job-page-service";
import { JOB_FILTER_VALUES, JOB_SORTS } from "@/services/jobs/job-page-types";

const log = logger.child({ route: "jobs/list" });

const QuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(JOB_MAX_PAGE_SIZE).default(25),
    filter: z.enum(JOB_FILTER_VALUES).default("all"),
    search: z.string().max(200).optional(),
    sort: z.enum(JOB_SORTS).default("createdAt"),
    order: z.enum(["asc", "desc"]).optional(),
    tenant: z.array(z.string().min(1).max(200)).max(500),
    id: z.array(z.string().min(1).max(200)).max(JOB_MAX_PAGE_SIZE),
});

/**
 * GET /api/jobs/list
 * One page of the jobs of the Jobs page, newest first unless `sort` and `order` say otherwise, with
 * how many jobs each quick filter holds and the numbers above the list. `filter` is a quick filter
 * (attention, running, paused), `search` a part of the name, `tenant` may repeat in All tenants, and
 * `id` may repeat to read those jobs whatever the filters, like the one a link opens.
 */
export async function GET(req: NextRequest) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.JOBS.READ);
    } catch (error: unknown) {
        if (error instanceof PermissionError) return NextResponse.json({ success: false, error: error.message }, { status: 403 });
        throw error;
    }

    const params = req.nextUrl.searchParams;
    const parsed = QuerySchema.safeParse({
        page: params.get("page") ?? undefined,
        pageSize: params.get("pageSize") ?? undefined,
        filter: params.get("filter") ?? undefined,
        search: params.get("search") ?? undefined,
        sort: params.get("sort") ?? undefined,
        order: params.get("order") ?? undefined,
        tenant: params.getAll("tenant"),
        id: params.getAll("id"),
    });
    if (!parsed.success) return NextResponse.json({ success: false, error: "Invalid query parameters" }, { status: 400 });

    const query = parsed.data;
    try {
        const data = await listJobPage({
            page: query.page,
            pageSize: query.pageSize,
            filter: query.filter,
            search: query.search,
            sort: query.sort,
            // The newest first and names from A, unless the order is given.
            desc: query.order ? query.order === "desc" : query.sort === "createdAt",
            // The Tenant filter of All tenants. Inside a tenant every job is of that tenant anyway.
            tenantIds: ctx.allTenants ? query.tenant : [],
            ids: query.id,
        }, { byTenant: ctx.allTenants });
        return NextResponse.json({ success: true, data });
    } catch (error: unknown) {
        log.error("Failed to list the jobs", {}, wrapError(error));
        return NextResponse.json({ success: false, error: "Failed to load the jobs" }, { status: 500 });
    }
}
