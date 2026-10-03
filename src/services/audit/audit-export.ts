import prisma from "@/lib/prisma";
import { buildAuditWhere, type AuditFilter } from "./audit-query";
import { AUDIT_ROW_SELECT, resolveTargets, toRow } from "./audit-rows";

/** The most entries one export holds, newest first. */
export const AUDIT_EXPORT_LIMIT = 50_000;

const HEADER = ["Time (UTC)", "Who", "API key", "Action", "Area", "What", "Record ID", "Address", "Browser", "Details"];

/**
 * A cell as CSV: quoted when it holds a comma, a quote or a line break. A cell that starts like a
 * formula gets a quote in front, so a spreadsheet shows it instead of running it.
 */
export function csvCell(value: string | null | undefined): string {
    let text = value ?? "";
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The entries a filter keeps as a CSV file, one line each, with the sentence the list shows. */
export async function auditCsv(filter: AuditFilter, now = new Date()): Promise<{ csv: string; count: number }> {
    const records = await prisma.auditLog.findMany({
        where: buildAuditWhere(filter, now),
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: AUDIT_EXPORT_LIMIT,
        select: AUDIT_ROW_SELECT,
    });
    const targets = await resolveTargets(records);
    const lines = [HEADER.join(",")];
    for (const record of records) {
        const row = toRow(record, targets, new Set());
        const what = row.parts.map((part) => part.text).join("") + (row.summary ? `: ${row.summary}` : "");
        lines.push([
            row.at,
            row.actor.kind === "key" ? record.user?.name ?? record.actorName : row.actor.name,
            record.apiKeyName,
            record.action,
            row.area,
            what,
            record.resourceId,
            record.ipAddress,
            record.userAgent,
            record.details,
        ].map(csvCell).join(","));
    }
    // A byte order mark, so a spreadsheet reads the names as UTF-8.
    return { csv: `﻿${lines.join("\r\n")}\r\n`, count: records.length };
}
