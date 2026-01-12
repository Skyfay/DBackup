import prisma from "@/lib/prisma";
import { registry } from "@/lib/core/registry";
import { registerAdapters } from "@/lib/adapters";
import { DatabaseAdapter, StorageAdapter, NotificationAdapter } from "@/lib/core/interfaces";
import path from "path";
import fs from "fs";
import os from "os";

// Ensure adapters are loaded
registerAdapters();

export async function runJob(jobId: string) {
    console.log(`[Runner] Starting execution for Job ID: ${jobId}`);

    // 1. Fetch Job Details
    const job = await prisma.job.findUnique({
        where: { id: jobId },
        include: {
            source: true,
            destination: true,
            notifications: true
        }
    });

    if (!job) {
        throw new Error(`Job ${jobId} not found`);
    }

    if (!job.source || !job.destination) {
        throw new Error(`Job ${jobId} is missing source or destination linkage`);
    }

    // 2. Prepare Execution Record
    const execution = await prisma.execution.create({
        data: {
            jobId: job.id,
            status: "Running",
            logs: JSON.stringify([]),
            startedAt: new Date(),
        }
    });

    const logs: string[] = [];
    const log = (msg: string) => {
        console.log(`[Job ${job.name}] ${msg}`);
        logs.push(`${new Date().toISOString()}: ${msg}`);
    };

    let status: "Success" | "Failed" = "Success";
    let tempFile: string | null = null;
    let dumpSize = 0;
    let finalRemotePath: string | null = null;
    let metadata: any = null;

    try {
        log("Initialization started");

        // 3. Resolve Adapters
        const sourceAdapter = registry.get(job.source.adapterId) as DatabaseAdapter;
        const destAdapter = registry.get(job.destination.adapterId) as StorageAdapter;

        if (!sourceAdapter) throw new Error(`Source adapter '${job.source.adapterId}' not found`);
        if (!destAdapter) throw new Error(`Destination adapter '${job.destination.adapterId}' not found`);

        // 4. Prepare Paths
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const fileName = `${job.name.replace(/[^a-z0-9]/gi, '_')}_${timestamp}.sql`; // Basic assumption for SQL, adapter might append extension
        const tempDir = os.tmpdir();
        tempFile = path.join(tempDir, fileName);

        log(`Prepared temporary path: ${tempFile}`);

        // 5. Execute Dump (Source)
        log(`Starting Dump from ${job.source.name} (${job.source.type})...`);
        const sourceConfig = JSON.parse(job.source.config);

        // Determine Metadata from Config
        // Common logic to determine DB count, matching Adapter logic
        try {
              const dbVal = sourceConfig.database;
              const options = sourceConfig.options || "";
              const isAll = options.includes("--all-databases");

              let label = 'Unknown';
              let count: number | string = 'Unknown';

              if (isAll) {
                  label = 'All DBs';
                  count = 'All';
              } else if (Array.isArray(dbVal)) {
                  label = `${dbVal.length} DBs`;
                  count = dbVal.length;
              } else if (typeof dbVal === 'string') {
                  if (dbVal.includes(',')) {
                      const parts = dbVal.split(',').filter((s: string) => s.trim().length > 0);
                      label = `${parts.length} DBs`;
                      count = parts.length;
                  } else if (dbVal.trim().length > 0) {
                      label = 'Single DB';
                      count = 1;
                  } else {
                       // Empty string usually implies default DB or all?
                       // If no database specified, mysqldump might fail or dump nothing depending on args.
                       label = 'No DB selected';
                       count = 0;
                  }
              }

              // Debug log to help identify issues
              console.log(`[Job ${job.name}] Calculated metadata:`, { label, count, dbVal });

              metadata = {
                  label,
                  count,
                  jobName: job.name,
                  sourceName: job.source.name,
                  sourceType: job.source.type,
                  adapterId: job.source.adapterId
              };
        } catch (e) {
            console.error(`[Job ${job.name}] Failed to calculate metadata:`, e);
        }

        // Ensure config has required fields passed from the Source entity logic if needed
        // The adapter expects the raw config object stored in DB

        const dumpResult = await sourceAdapter.dump(sourceConfig, tempFile);

        if (!dumpResult.success) {
            throw new Error(`Dump failed: ${dumpResult.error}`);
        }

        // If adapter appended an extension (like .gz), use that path
        if (dumpResult.path && dumpResult.path !== tempFile) {
            tempFile = dumpResult.path;
        }

        dumpSize = dumpResult.size || 0;
        log(`Dump successful. Size: ${dumpResult.size} bytes`);

        // 6. Execute Upload (Destination)
        log(`Starting Upload to ${job.destination.name} (${job.destination.type})...`);
        const destConfig = JSON.parse(job.destination.config);

        // Define remote path (Standard: /backups/JobName/FileName)
        finalRemotePath = `/backups/${job.name}/${path.basename(tempFile)}`;

        const uploadSuccess = await destAdapter.upload(destConfig, tempFile, finalRemotePath);

        if (!uploadSuccess) {
            throw new Error("Upload failed (Adapter returned false)");
        }

        log(`Upload successful to ${finalRemotePath}`);

        // 7. Success Finalization
        status = "Success";
        log("Job completed successfully");

    } catch (error: any) {
        status = "Failed";
        log(`ERROR: ${error.message}`);
        console.error(error);
    } finally {
        // 8. Cleanup
        if (tempFile && fs.existsSync(tempFile)) {
            try {
                fs.unlinkSync(tempFile);
                log("Temporary file cleaned up");
            } catch (e) {
                log("Warning: Failed to cleanup temp file");
            }
        }

        // 9. Update Execution Record
        await prisma.execution.update({
            where: { id: execution.id },
            data: {
                status: status,
                endedAt: new Date(),
                logs: JSON.stringify(logs), // Store as simple string array for now
                size: dumpSize,
                path: finalRemotePath,
                metadata: metadata ? JSON.stringify(metadata) : null
            }
        });

        // 10. Notifications
        if (job.notifications.length > 0) {
            log("Sending notifications...");
            for (const notifyLink of job.notifications) {
                try {
                    // We need to fetch the actual Source entity for the notification channel
                    // The 'notifications' relation in Job is likely to 'Notification' entity?
                    // Wait, let's check schema. Relation is `notifications Source[]`.
                    // No, `notifications` is `Source`? Wait, I need to check schema.prisma

                    // Assuming job.notifications acts as the channel "Source" (User configured notification endpoints are stored in Source table with type='notification'?)
                    // Let's verify schema quickly before assuming.

                    const channel = notifyLink; // fetched via include
                    const notifyAdapter = registry.get(channel.adapterId) as NotificationAdapter;

                    if (notifyAdapter) {
                        const channelConfig = JSON.parse(channel.config);
                        await notifyAdapter.send(channelConfig, `Backup Job '${job.name}' finished with status: ${status}`, {
                             jobName: job.name,
                             adapterName: job.source.name,
                             success: status === "Success",
                             duration: new Date().getTime() - execution.startedAt.getTime(),
                             size: dumpSize,
                             status,
                             logs
                        });
                    }
                } catch (e) {
                    console.error("Failed to send notification", e);
                }
            }
        }
    }

    return { status, logs };
}
