import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { headers } from "next/headers";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getExecutionHistoryFacets, listExecutionHistory } from "@/services/system/execution-history-service";

const QuerySchema = z.object({
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).optional(),
    scope: z.enum(["activity", "system", "all"]).optional(),
    type: z.array(z.string()).optional(),
    status: z.array(z.string()).optional(),
    trigger: z.array(z.string()).optional(),
    search: z.string().max(200).optional(),
    facets: z.enum(["true", "false"]).optional(),
});

/**
 * Paged execution history, newest first.
 *
 * `type`, `status` and `trigger` may be repeated to match any of several values.
 * `facets=true` adds per-option counts for those three filters.
 * The History page polls this every few seconds, so each call returns one page
 * without the log blobs. The open dialog fetches its log from /api/executions/[id].
 */
export async function GET(req: NextRequest) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.HISTORY.READ);

        const params = req.nextUrl.searchParams;
        const parsed = QuerySchema.safeParse({
            page: params.get("page") ?? undefined,
            pageSize: params.get("pageSize") ?? undefined,
            scope: params.get("scope") ?? undefined,
            type: params.getAll("type"),
            status: params.getAll("status"),
            trigger: params.getAll("trigger"),
            search: params.get("search") ?? undefined,
            facets: params.get("facets") ?? undefined,
        });
        if (!parsed.success) {
            return NextResponse.json({ error: "Invalid query parameters" }, { status: 400 });
        }
        const q = parsed.data;

        const historyQuery = {
            page: q.page,
            pageSize: q.pageSize,
            scope: q.scope,
            types: q.type,
            statuses: q.status,
            triggers: q.trigger,
            search: q.search,
        };
        const [result, facets, tzSetting] = await Promise.all([
            listExecutionHistory(historyQuery),
            q.facets === "true" ? getExecutionHistoryFacets(historyQuery) : Promise.resolve(undefined),
            prisma.systemSetting.findUnique({ where: { key: "system.timezone" } })
        ]);

        return NextResponse.json({
            executions: result.data,
            total: result.total,
            page: result.page,
            pageSize: result.pageSize,
            ...(facets ? { facets } : {}),
            systemTimezone: tzSetting?.value || "UTC"
        });
    } catch (_error) {
        return NextResponse.json({ error: "Failed to fetch history" }, { status: 500 });
    }
}
