import type { ExecutionHost } from "@/lib/transport";
import { MongoDBConfig } from "@/lib/adapters/definitions";
import { TableInfo, ColumnInfo, TableDataOptions, TableDataResult } from "@/lib/core/interfaces";
import { ValidationError } from "@/lib/logging/errors";
import { withMongoMeta } from "./meta";


/** Flatten BSON document values to display-safe primitives. */
function flattenDoc(doc: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(doc)) {
        if (v === null || v === undefined || typeof v !== "object") {
            out[k] = v;
        } else {
            // Represent nested objects/arrays as compact JSON string
            try {
                out[k] = JSON.stringify(v);
            } catch {
                out[k] = String(v);
            }
        }
    }
    return out;
}

/** Derive ColumnInfo from a set of documents (union of all keys). */
function deriveColumns(docs: Record<string, unknown>[]): ColumnInfo[] {
    const seen = new Map<string, string>();
    for (const doc of docs) {
        for (const [k, v] of Object.entries(doc)) {
            if (!seen.has(k)) {
                let dataType: string = typeof v;
                if (v === null) dataType = "null";
                else if (Array.isArray(v)) dataType = "array";
                seen.set(k, dataType);
            }
        }
    }
    return Array.from(seen.entries()).map(([name, dataType]) => ({
        name,
        dataType,
        primaryKey: name === "_id",
        nullable: true,
    }));
}


export async function getTables(
    config: MongoDBConfig,
    database: string,
    host: ExecutionHost,
): Promise<TableInfo[]> {
    const collections = await withMongoMeta(config, host, (meta) => meta.listCollections(database));
    return collections.map((c) => ({
        name: c.name,
        type: "collection" as const,
        rowCount: c.estimatedCount,
    }));
}

/**
 * A column the reader searches or sorts by becomes a key of the filter or the sort. A key that
 * starts with `$` is an operator there, and `$where` runs its value as JavaScript on the server, so
 * a column is a field name and nothing else.
 */
function assertFieldName(field: unknown): void {
    if (field === undefined || field === null || field === "") return;
    if (typeof field !== "string" || field.startsWith("$") || field.includes("\0")) {
        throw new ValidationError("The column to search or sort by is no field of the collection.");
    }
}

export async function getTableData(
    config: MongoDBConfig,
    options: TableDataOptions,
    host: ExecutionHost,
): Promise<TableDataResult> {
    const { database, table, page, pageSize, sortBy, sortDir, search, searchColumn, matchMode } = options;
    assertFieldName(searchColumn);
    assertFieldName(sortBy);

    function buildMongoFilter(field: string, term: string): Record<string, unknown> {
        const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        if (matchMode === "equals") return { [field]: term };
        if (matchMode === "starts") return { [field]: { $regex: `^${escaped}`, $options: "i" } };
        if (matchMode === "ends") return { [field]: { $regex: `${escaped}$`, $options: "i" } };
        return { [field]: { $regex: term, $options: "i" } };
    }

    const filter = search && searchColumn ? buildMongoFilter(searchColumn, search) : {};
    const sort = sortBy ? ({ [sortBy]: sortDir === "desc" ? -1 : 1 } as Record<string, 1 | -1>) : undefined;

    const pageResult = await withMongoMeta(config, host, (meta) =>
        meta.findPage(database, table, { filter, sort, skip: (page - 1) * pageSize, limit: pageSize }),
    );

    const docs = pageResult.docs.map(flattenDoc);
    return { rows: docs, totalCount: pageResult.total, columns: deriveColumns(docs) };
}
