import { PrismaClient } from "@prisma/client";
import { subHours, subDays } from "date-fns";

const prisma = new PrismaClient();

/**
 * Seeds StorageSnapshot test data for the Storage History chart.
 *
 * Usage: npx tsx scripts/seed-storage-snapshots.ts
 *
 * Generates realistic storage growth data over the past 30 days
 * for the "Local Storage" / "local" destination.
 */
async function main() {
  console.log("🌱 Seeding storage snapshot test data...\n");

  // Find or identify the Local Storage adapter config
  let adapterConfig = await prisma.adapterConfig.findFirst({
    where: { adapterId: "local-filesystem", type: "storage" },
  });

  if (!adapterConfig) {
    console.log(
      "⚠️  No Local Storage adapter config found. Creating a placeholder..."
    );
    adapterConfig = await prisma.adapterConfig.create({
      data: {
        name: "Local Storage",
        type: "storage",
        adapterId: "local",
        config: JSON.stringify({ path: "./backups" }),
      },
    });
    console.log(`   Created adapter config: ${adapterConfig.id}\n`);
  } else {
    console.log(`   Found adapter config: ${adapterConfig.name} (${adapterConfig.id})\n`);
  }

  // Clean up existing test snapshots for this adapter
  const deleted = await prisma.storageSnapshot.deleteMany({
    where: { adapterConfigId: adapterConfig.id },
  });
  if (deleted.count > 0) {
    console.log(`   Cleaned up ${deleted.count} existing snapshots.\n`);
  }

  // Generate 30 days of hourly data points (720 snapshots)
  // Simulate realistic storage growth with some variation
  const now = new Date();
  const daysBack = 30;
  const hoursPerSnapshot = 1; // one snapshot per hour (matches system task default)
  const totalSnapshots = (daysBack * 24) / hoursPerSnapshot;

  // Starting values
  let currentSize = 150 * 1024 * 1024; // Start at 150 MB
  let currentCount = 5;

  const snapshots: {
    adapterConfigId: string;
    adapterName: string;
    adapterId: string;
    size: bigint;
    count: number;
    createdAt: Date;
  }[] = [];

  for (let i = totalSnapshots; i >= 0; i--) {
    const createdAt = subHours(now, i);

    // Simulate backup events (roughly 2-3 per day = every 8-12 hours)
    const hourOfDay = createdAt.getHours();
    const dayIndex = Math.floor(i / 24);

    // Add a backup roughly every 8 hours (at hour 2, 10, 18)
    if (hourOfDay === 2 || hourOfDay === 10 || hourOfDay === 18) {
      // Each backup adds 10-50 MB
      const backupSize =
        (10 + Math.random() * 40) * 1024 * 1024;
      currentSize += backupSize;
      currentCount += 1;
    }

    // Simulate retention cleanup once per day at midnight
    if (hourOfDay === 0 && dayIndex > 5 && Math.random() > 0.3) {
      // Remove 1-2 old backups (5-30 MB each)
      const removedCount = Math.random() > 0.5 ? 2 : 1;
      const removedSize =
        removedCount * (5 + Math.random() * 25) * 1024 * 1024;
      currentSize = Math.max(currentSize - removedSize, 50 * 1024 * 1024);
      currentCount = Math.max(currentCount - removedCount, 3);
    }

    // Add some random noise (±1%)
    const noise = 1 + (Math.random() - 0.5) * 0.02;

    snapshots.push({
      adapterConfigId: adapterConfig.id,
      adapterName: adapterConfig.name,
      adapterId: adapterConfig.adapterId,
      size: BigInt(Math.round(currentSize * noise)),
      count: currentCount,
      createdAt,
    });
  }

  // Batch insert
  await prisma.storageSnapshot.createMany({ data: snapshots });

  const finalSize = Number(snapshots[snapshots.length - 1].size);
  const startSize = Number(snapshots[0].size);

  console.log(`✅ Seeded ${snapshots.length} storage snapshots.`);
  console.log(`   Adapter:    ${adapterConfig.name} (${adapterConfig.adapterId})`);
  console.log(`   Config ID:  ${adapterConfig.id}`);
  console.log(`   Period:     ${daysBack} days (${subDays(now, daysBack).toISOString()} → ${now.toISOString()})`);
  console.log(`   Start size: ${formatBytes(startSize)} (${snapshots[0].count} backups)`);
  console.log(`   End size:   ${formatBytes(finalSize)} (${snapshots[snapshots.length - 1].count} backups)`);
  console.log(`   Growth:     ${formatBytes(finalSize - startSize)}`);
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

main()
  .catch((e) => {
    console.error("❌ Seeding failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
