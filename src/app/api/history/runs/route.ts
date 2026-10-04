import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";
import { cached } from "@/services/dashboard/cache";
import { getRunFacets, getRunOptions, getRunStats, listRuns, RUN_MAX_PAGE_SIZE } from "@/services/history/run-list-service";
import type { RunPage } from "@/services/history/run-types";

const log = logger.child({ route: "history/runs" });
const OPTIONS_TTL_MS = 30 * 1000;

const QuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(RUN_MAX_PAGE_SIZE).default(25),
    type: z.array(z.string().max(100)).max(20),
    status: z.array(z.string().max(20)).max(10),
    job: z.array(z.string().max(100)).max(200),
    by: z.array(z.string().max(300)).max(200),
    search: z.string().max(200).optional(),
});

/**
 * One page of the runs of the History page, with the counts beside every filter, the options of
 * the Job and Started by filters and the numbers above the list. Filters may repeat to match any
 * of their values: `type`, `status`, `job` (a job id) and `by` (schedule, manual:<person>,
 * api:<key name> or none).
 */
export async function GET(req: NextRequest) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.HISTORY.READ);
    } catch {
        return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }

    const params = req.nextUrl.searchParams;
    const parsed = QuerySchema.safeParse({
        page: params.get("page") ?? undefined,
        pageSize: params.get("pageSize") ?? undefined,
        type: params.getAll("type"),
        status: params.getAll("status"),
        job: params.getAll("job"),
        by: params.getAll("by"),
        search: params.get("search") ?? undefined,
    });
    if (!parsed.success) return NextResponse.json({ success: false, error: "Invalid query parameters" }, { status: 400 });

    const query = {
        page: parsed.data.page,
        pageSize: parsed.data.pageSize,
        types: parsed.data.type,
        statuses: parsed.data.status,
        jobIds: parsed.data.job,
        starters: parsed.data.by,
        search: parsed.data.search,
    };
    try {
        const [list, facets, options, stats] = await Promise.all([
            listRuns(query),
            getRunFacets(query),
            cached("history-run-options", OPTIONS_TTL_MS, getRunOptions),
            getRunStats(),
        ]);
        const data: RunPage = { rows: list.rows, total: list.total, facets, jobs: options.jobs, starters: options.starters, stats };
        return NextResponse.json({ success: true, data });
    } catch (error) {
        log.error("Failed to list the runs", {}, wrapError(error));
        return NextResponse.json({ success: false, error: "The runs could not be loaded." }, { status: 500 });
    }
}
