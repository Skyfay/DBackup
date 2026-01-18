
import { NextRequest, NextResponse } from "next/server";
import { registry } from "@/lib/core/registry";
import { registerAdapters } from "@/lib/adapters"; // Import registration
import { StorageAdapter, BackupMetadata } from "@/lib/core/interfaces";
import { decryptConfig } from "@/lib/crypto";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { checkPermission } from "@/lib/access-control";
import { PERMISSIONS } from "@/lib/permissions";

// Ensure adapters are registered in this route handler environment
registerAdapters();

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const session = await auth.api.getSession({
        headers: await headers()
    });

    if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        await checkPermission(PERMISSIONS.STORAGE.READ);

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
        const config = decryptConfig(JSON.parse(adapterConfig.config));

        // List files (assuming root for now, or use query param for subdirs logic later)
        const allFiles = await adapter.list(config, "");

        // Filter Backups vs Metadata
        const backups = allFiles.filter(f => !f.name.endsWith('.meta.json'));
        const metadataFiles = allFiles.filter(f => f.name.endsWith('.meta.json'));

        // Load Sidecar Metadata
        const metadataMap = new Map<string, BackupMetadata>();
        if (adapter.read) {
            const metaReads = metadataFiles.map(async (metaFile) => {
                try {
                    const content = await adapter.read!(config, metaFile.path);
                    if (content) {
                        const meta = JSON.parse(content) as BackupMetadata;
                        // Key should correspond to the backup file name.
                        // We saved it as backupFile + ".meta.json"
                        // So removing suffix gives backup filename.
                        const originalName = metaFile.name.substring(0, metaFile.name.length - 10);
                        metadataMap.set(originalName, meta);
                    }
                } catch (e) {
                    // ignore read errors
                }
            });
            await Promise.all(metaReads);
        }

        // Enrich with Job and Source info (FALLBACK LOGIC PREPARATION)
        const jobNames = new Set<string>();
        for (const file of backups) {
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

        const enrichedFiles = backups.map(file => {
             // 1. Check Sidecar Metadata (Primary Source of Truth)
             const sidecar = metadataMap.get(file.name);
             if (sidecar) {
                 const count = typeof sidecar.databases === 'object' ? sidecar.databases.count : (typeof sidecar.databases === 'number' ? sidecar.databases : 0);
                 const label = count === 0 ? "Unknown" : (count === 1 ? "Single DB" : `${count} DBs`);

                 return {
                     ...file,
                     jobName: sidecar.jobName,
                     sourceName: sidecar.sourceName,
                     sourceType: sidecar.sourceType,
                     dbInfo: { count, label }
                 };
             }

             // 2. Fallback to Execution History / Regex Logic
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

             let dbInfo: { count: string | number; label: string } = { count: 'Unknown', label: '' };

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
                 } catch {}
             }

             // 2. Fallback to current config
             if (dbInfo.label === '' && job && job.source) {
                  try {
                      // Attempt to parse source config to guess DB count
                      const sc = decryptConfig(JSON.parse(job.source.config));
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
                  } catch {
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

    } catch (error: unknown) {
        console.error("List files error:", error);
        const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
        return NextResponse.json({ error: errorMessage }, { status: 500 });
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

        const config = decryptConfig(JSON.parse(adapterConfig.config));
        const success = await adapter.delete(config, path);

        if (!success) {
             return NextResponse.json({ error: "Failed to delete file" }, { status: 500 });
        }

        return NextResponse.json({ success: true });

    } catch (error: unknown) {
        console.error("Delete file error:", error);
        const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
        return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
}
