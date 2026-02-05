/**
 * Demo Mode Initialization
 *
 * This file contains server-only code for initializing demo mode.
 * It should only be imported from instrumentation.ts or other server-only contexts.
 */

import { logger } from "@/lib/logger";
import { isDemoMode, getDemoCredentials } from "@/lib/demo-mode";

const log = logger.child({ module: "demo-init" });

/**
 * Initialize demo mode by creating the demo user if it doesn't exist.
 * This should be called during application startup (instrumentation.ts).
 *
 * Uses better-auth signUpEmail API to properly hash passwords.
 *
 * Creates:
 * - SuperAdmin group (if not exists)
 * - Demo user with credentials from environment variables
 */
export async function initializeDemoMode(): Promise<void> {
  if (!isDemoMode()) {
    return;
  }

  const credentials = getDemoCredentials();
  if (!credentials) {
    log.error("Demo mode enabled but credentials not configured");
    return;
  }

  log.info("Initializing demo mode...");

  try {
    // Dynamic imports to avoid circular dependencies
    const { PrismaClient } = await import("@prisma/client");
    const { randomUUID } = await import("crypto");
    const { auth } = await import("@/lib/auth");

    const prisma = new PrismaClient();

    try {
      // Check if demo user already exists
      const existingUser = await prisma.user.findUnique({
        where: { email: credentials.email },
      });

      if (existingUser) {
        log.info("Demo user already exists", { email: credentials.email });
        return;
      }

      // Create SuperAdmin group if not exists
      let superAdminGroup = await prisma.group.findUnique({
        where: { name: "SuperAdmin" },
      });

      if (!superAdminGroup) {
        superAdminGroup = await prisma.group.create({
          data: {
            id: randomUUID(),
            name: "SuperAdmin",
            permissions: JSON.stringify([
              "sources:read", "sources:write", "sources:delete",
              "destinations:read", "destinations:write", "destinations:delete",
              "jobs:read", "jobs:write", "jobs:delete", "jobs:execute",
              "history:read", "history:delete",
              "storage:read", "storage:delete", "storage:restore",
              "users:read", "users:write",
              "settings:read", "settings:write",
              "vault:read", "vault:write",
              "audit:read",
            ]),
          },
        });
        log.info("Created SuperAdmin group");
      }

      // Create demo user via better-auth (handles password hashing)
      await auth.api.signUpEmail({
        body: {
          name: "Demo User",
          email: credentials.email,
          password: credentials.password,
        },
      });

      // Assign SuperAdmin group to the user
      await prisma.user.update({
        where: { email: credentials.email },
        data: {
          groupId: superAdminGroup.id,
          emailVerified: true,
        },
      });

      log.info("Demo user created successfully", { email: credentials.email });

      // Create demo database sources and storage destination
      await createDemoSources(prisma, randomUUID);
    } finally {
      await prisma.$disconnect();
    }
  } catch (error) {
    log.error("Failed to initialize demo mode", { error });
  }
}

/**
 * Creates demo database sources and storage destination.
 * Uses encrypted passwords for security.
 */
async function createDemoSources(
  prisma: import("@prisma/client").PrismaClient,
  randomUUID: () => string
): Promise<void> {
  const { encrypt } = await import("@/lib/crypto");

  // MySQL Demo Source (using root for full backup access)
  const mysqlConfig = {
    host: "mysql-demo",
    port: 3306,
    user: "root",
    password: encrypt("demorootpassword"),
    database: ["demo_app"],
  };

  await prisma.adapterConfig.upsert({
    where: { id: "demo-mysql-source" },
    update: { config: JSON.stringify(mysqlConfig) },
    create: {
      id: "demo-mysql-source",
      name: "MySQL Demo Server",
      type: "database",
      adapterId: "mysql",
      config: JSON.stringify(mysqlConfig),
    },
  });
  log.info("Created MySQL demo source");

  // PostgreSQL Demo Source
  const postgresConfig = {
    host: "postgres-demo",
    port: 5432,
    user: "demouser",
    password: encrypt("demopassword"),
    database: ["demo_app"],
  };

  await prisma.adapterConfig.upsert({
    where: { id: "demo-postgres-source" },
    update: { config: JSON.stringify(postgresConfig) },
    create: {
      id: "demo-postgres-source",
      name: "PostgreSQL Demo Server",
      type: "database",
      adapterId: "postgres",
      config: JSON.stringify(postgresConfig),
    },
  });
  log.info("Created PostgreSQL demo source");

  // MongoDB Demo Source
  const mongoConfig = {
    host: "mongo-demo",
    port: 27017,
    user: "root",
    password: encrypt("demorootpassword"),
    authenticationDatabase: "admin",
    database: ["demo_app"],
  };

  await prisma.adapterConfig.upsert({
    where: { id: "demo-mongo-source" },
    update: { config: JSON.stringify(mongoConfig) },
    create: {
      id: "demo-mongo-source",
      name: "MongoDB Demo Server",
      type: "database",
      adapterId: "mongodb",
      config: JSON.stringify(mongoConfig),
    },
  });
  log.info("Created MongoDB demo source");

  // Local Storage Destination
  const localStorageConfig = {
    basePath: "/backups",
  };

  await prisma.adapterConfig.upsert({
    where: { id: "demo-local-storage" },
    update: { config: JSON.stringify(localStorageConfig) },
    create: {
      id: "demo-local-storage",
      name: "Local Backup Storage",
      type: "storage",
      adapterId: "local-filesystem",
      config: JSON.stringify(localStorageConfig),
    },
  });
  log.info("Created local storage destination");

  // Create sample backup jobs
  await createDemoJobs(prisma, randomUUID);
}

/**
 * Creates sample backup jobs for the demo environment.
 */
async function createDemoJobs(
  prisma: import("@prisma/client").PrismaClient,
  randomUUID: () => string
): Promise<void> {
  // MySQL Daily Backup Job
  await prisma.job.upsert({
    where: { id: "demo-job-mysql-daily" },
    update: {},
    create: {
      id: "demo-job-mysql-daily",
      name: "MySQL Daily Backup",
      schedule: "0 2 * * *", // 2 AM daily
      enabled: true,
      sourceId: "demo-mysql-source",
      destinationId: "demo-local-storage",
      compression: "GZIP",
      retention: JSON.stringify({
        type: "simple",
        keepLast: 7,
      }),
    },
  });
  log.info("Created MySQL daily backup job");

  // PostgreSQL Hourly Backup Job
  await prisma.job.upsert({
    where: { id: "demo-job-postgres-hourly" },
    update: {},
    create: {
      id: "demo-job-postgres-hourly",
      name: "PostgreSQL Hourly Backup",
      schedule: "0 * * * *", // Every hour
      enabled: true,
      sourceId: "demo-postgres-source",
      destinationId: "demo-local-storage",
      compression: "GZIP",
      retention: JSON.stringify({
        type: "simple",
        keepLast: 24,
      }),
    },
  });
  log.info("Created PostgreSQL hourly backup job");

  // MongoDB Weekly Backup Job
  await prisma.job.upsert({
    where: { id: "demo-job-mongo-weekly" },
    update: {},
    create: {
      id: "demo-job-mongo-weekly",
      name: "MongoDB Weekly Backup",
      schedule: "0 3 * * 0", // 3 AM on Sundays
      enabled: true,
      sourceId: "demo-mongo-source",
      destinationId: "demo-local-storage",
      compression: "GZIP",
      retention: JSON.stringify({
        type: "gvs",
        daily: 7,
        weekly: 4,
        monthly: 3,
      }),
    },
  });
  log.info("Created MongoDB weekly backup job");
}
