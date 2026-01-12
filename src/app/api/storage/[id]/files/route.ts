
import { NextRequest, NextResponse } from "next/server";
import { registry } from "@/lib/core/registry";
import { registerAdapters } from "@/lib/adapters"; // Import registration
import { StorageAdapter } from "@/lib/core/interfaces";
import prisma from "@/lib/prisma";

// Ensure adapters are registered in this route handler environment
registerAdapters();

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
    try {
        const params = await props.params;
        const adapterConfig = await prisma.adapterConfig.findUnique({
            where: { id: params.id }
        });

        if (!adapterConfig) {
            return NextResponse.json({ error: "Adapter not found" }, { status: 404 });
        }

        if (adapterConfig.type !== "storage") {
            return NextResponse.json({ error: "Not a storage adapter" }, { status: 400 });
        }

        const adapter = registry.get(adapterConfig.adapterId) as StorageAdapter;
        if (!adapter) {
            return NextResponse.json({ error: "Adapter implementation not found" }, { status: 500 });
        }

        // Parse config
        const config = JSON.parse(adapterConfig.config);

        // List files (assuming root for now, or use query param for subdirs logic later)
        const files = await adapter.list(config, "");

        // Enrich with Job and Source info
        const jobNames = new Set<string>();
        for (const file of files) {
             const parts = file.path.split('/');
             if (parts.length > 2 && parts[0] === 'backups') {
                 // backups/JobName/File
                 jobNames.add(parts[1]);
             } else if (parts.length > 1 && parts[0] !== 'backups') {
                 // JobName/File
                 jobNames.add(parts[0]);
             } else {
                  // Try regex match on filename for fallback: jobname_timestamp
                  // Note: creating job name logic in runner replaces special chars with _
                  // If job name was "My-Job", it became "My_Job". We can only match on the transformed name.
                  const match = file.name.match(/^(.+?)_\d{4}-\d{2}-\d{2}/);
                  if (match && match[1]) {
                      // This might be tricky if job name has underscores, but it's a best effort
                       jobNames.add(match[1]);
                  }
             }
        }

        // Fetch jobs. Note: We are matching against job 'name', but the folders might be using sanitized names.
        // The runner does: job.name.replace(/[^a-z0-9]/gi, '_')
        // So we really should fetch all jobs and assume we can map them, or store the sanitized name.
        // For now, let's fetch all jobs and build a map of sanitized -> job
        const allJobs = await prisma.job.findMany({
             include: { source: true }
        });

        const jobMap = new Map();
        allJobs.forEach(j => {
             const sanitized = j.name.replace(/[^a-z0-9]/gi, '_');
             jobMap.set(sanitized, j);
             // Also map keys to the raw name just in case
             jobMap.set(j.name, j);
        });

        // Fetch executions for metadata (to get snapshot of config at time of backup)
        // We only care about executions that have a path and are successful
        const executions = await prisma.execution.findMany({
            where: {
                status: 'Success',
                path: { not: null }
            },
            select: {
                path: true,
                metadata: true
            }
        });

        const executionMap = new Map();
        executions.forEach(ex => {
            if (ex.path) {
                // Normalize paths to ensure matching works regardless of leading slash or OS differences
                // 1. Exact match
                executionMap.set(ex.path, ex.metadata);

                // 2. Strip leading slash (e.g. /backups -> backups)
                if (ex.path.startsWith('/')) {
                     executionMap.set(ex.path.substring(1), ex.metadata);
                }

                // 3. Add leading slash (e.g. backups -> /backups)
                if (!ex.path.startsWith('/')) {
                     executionMap.set('/' + ex.path, ex.metadata);
                }
            }
        });

        const enrichedFiles = files.map(file => {
             let potentialJobName = null;
             const parts = file.path.split('/');
              if (parts.length > 2 && parts[0] === 'backups') {
                 potentialJobName = parts[1];
             } else if (parts.length > 1 && parts[0] !== 'backups') {
                 potentialJobName = parts[0];
             } else {
                 const match = file.name.match(/^(.+?)_\d{4}-\d{2}-\d{2}/);
                 if (match) potentialJobName = match[1];
             }

             const job = potentialJobName ? jobMap.get(potentialJobName) : null;

             let dbInfo = { count: 'Unknown', label: '' };

             // 1. Try to get metadata from Execution record (Historical accuracy)
             const metaStr = executionMap.get(file.path);
             if (metaStr) {
                 try {
                     const meta = JSON.parse(metaStr);
                     if (meta.label) {
                         dbInfo = { count: meta.count || '?', label: meta.label };
                     }
                     if (meta.jobName) {
                         // Override the inferred job/source info with historical snapshot if available
                         return {
                             ...file,
                             jobName: meta.jobName,
                             sourceName: meta.sourceName,
                             sourceType: meta.sourceType,
                             dbInfo
                         }
                     }
                 } catch (e) {}
             }

             // 2. Fallback to current config
             if (dbInfo.label === '' && job && job.source) {
                  try {
                      // Attempt to parse source config to guess DB count
                      const sc = JSON.parse(job.source.config);
                      const dbVal = sc.database;

                      // Check for all-databases option
                      const options = sc.options || "";
                      const isAll = options.includes("--all-databases");

                      if (isAll) {
                          dbInfo = { count: 'All', label: 'All DBs' };
                      } else if (Array.isArray(dbVal)) {
                          dbInfo = { count: dbVal.length, label: `${dbVal.length} DBs` };
                      } else if (typeof dbVal === 'string') {
                          if (dbVal.includes(',')) {
                              const parts = dbVal.split(',').filter((s: string) => s.trim().length > 0);
                              dbInfo = { count: parts.length, label: `${parts.length} DBs` };
                          } else if (dbVal.trim().length > 0) {
                              dbInfo = { count: 1, label: 'Single DB' };
                          } else {
                              // Empty string and no --all-databases? Likely misconfig or implicit default
                               dbInfo = { count: '?', label: 'Unknown' };
                          }
                      }
                  } catch (e) {
                      // ignore parse error
                  }
             }

             return {
                  ...file,
                  jobName: job ? job.name : (potentialJobName || "Unknown"),
                  sourceName: job && job.source ? job.source.name : "Unknown",
                  sourceType: job && job.source ? job.source.adapterId : null,
                  dbInfo
             };
        });

        return NextResponse.json(enrichedFiles);

    } catch (error: any) {
        console.error("List files error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
    try {
        const { path } = await req.json();
        const params = await props.params;

        if (!path) {
            return NextResponse.json({ error: "Path is required" }, { status: 400 });
        }

        const adapterConfig = await prisma.adapterConfig.findUnique({
            where: { id: params.id }
        });

        if (!adapterConfig) {
            return NextResponse.json({ error: "Adapter not found" }, { status: 404 });
        }

        if (adapterConfig.type !== "storage") {
            return NextResponse.json({ error: "Not a storage adapter" }, { status: 400 });
        }

        const adapter = registry.get(adapterConfig.adapterId) as StorageAdapter;
        if (!adapter) {
            return NextResponse.json({ error: "Adapter implementation not found" }, { status: 500 });
        }

        const config = JSON.parse(adapterConfig.config);
        const success = await adapter.delete(config, path);

        if (!success) {
             return NextResponse.json({ error: "Failed to delete file" }, { status: 500 });
        }

        return NextResponse.json({ success: true });

    } catch (error: any) {
        console.error("Delete file error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
