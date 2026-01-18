
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const PERMISSIONS = {
  USERS: { READ: "users:read", WRITE: "users:write" },
  GROUPS: { READ: "groups:read", WRITE: "groups:write" },
  SOURCES: { READ: "sources:read", WRITE: "sources:write" },
  DESTINATIONS: { READ: "destinations:read", WRITE: "destinations:write" },
  JOBS: { READ: "jobs:read", WRITE: "jobs:write", EXECUTE: "jobs:execute" },
  STORAGE: { READ: "storage:read", DOWNLOAD: "storage:download", RESTORE: "storage:restore", DELETE: "storage:delete" },
  HISTORY: { READ: "history:read" },
  NOTIFICATIONS: { READ: "notifications:read", WRITE: "notifications:write" },
  VAULT: { READ: "vault:read", WRITE: "vault:write" },
  PROFILE: { UPDATE_NAME: "profile:update_name", UPDATE_EMAIL: "profile:update_email", UPDATE_PASSWORD: "profile:update_password", MANAGE_2FA: "profile:manage_2fa", MANAGE_PASSKEYS: "profile:manage_passkeys" },
  SETTINGS: { READ: "settings:read", WRITE: "settings:write" }
};

async function main() {
    // Flatten permissions
    const allPerms = [];
    for (const cat in PERMISSIONS) {
        for (const key in PERMISSIONS[cat]) {
            allPerms.push(PERMISSIONS[cat][key]);
        }
    }

    console.log("All Permissions:", allPerms);

    const groups = await prisma.group.findMany();
    console.log("Found Groups:", groups.map(g => g.name));

    // Update 'Admin' or 'SuperAdmin' group
    const targetGroups = groups.filter(g => g.name.toLowerCase().includes('admin'));

    for (const g of targetGroups) {
        console.log(`Updating permissions for group: ${g.name}`);
        await prisma.group.update({
            where: { id: g.id },
            data: { permissions: JSON.stringify(allPerms) }
        });
        console.log("Updated.");
    }
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
