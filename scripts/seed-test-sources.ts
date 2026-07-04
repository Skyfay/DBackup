
import { PrismaClient } from '@prisma/client';
import { testDatabases } from '../tests/integration/test-configs';

// Load .env if present so ENCRYPTION_KEY is available for credential encryption.
// Falls back silently if the file does not exist (e.g. env vars already set in CI).
try {
    process.loadEnvFile('.env');
} catch {
    // .env not found - ENCRYPTION_KEY must be set in the environment already
}

import { encrypt } from '../src/lib/crypto';

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Credential profiles for the test containers
// ---------------------------------------------------------------------------

interface CredentialProfileDef {
    name: string;
    type: 'USERNAME_PASSWORD';
    data: { username: string; password: string };
    description: string;
}

const CREDENTIAL_PROFILES: CredentialProfileDef[] = [
    {
        name: 'Test MySQL/MariaDB Credentials',
        type: 'USERNAME_PASSWORD',
        data: { username: 'root', password: 'rootpassword' },
        description: 'Root credentials for MySQL/MariaDB test containers',
    },
    {
        name: 'Test PostgreSQL Credentials',
        type: 'USERNAME_PASSWORD',
        data: { username: 'testuser', password: 'testpassword' },
        description: 'Credentials for PostgreSQL test containers',
    },
    {
        name: 'Test MongoDB Credentials',
        type: 'USERNAME_PASSWORD',
        data: { username: 'root', password: 'rootpassword' },
        description: 'Root credentials for MongoDB test containers',
    },
    {
        name: 'Test MSSQL Credentials',
        type: 'USERNAME_PASSWORD',
        data: { username: 'sa', password: 'YourStrong!Passw0rd' },
        description: 'SA credentials for MSSQL test containers',
    },
    {
        name: 'Test Redis Credentials',
        type: 'USERNAME_PASSWORD',
        // Redis 6+ ACL default user - the resolver overlays username only when non-empty,
        // so "default" triggers --user default which Redis accepts for the default ACL user.
        data: { username: 'default', password: 'testpassword' },
        description: 'Credentials for Redis test containers',
    },
];

// Maps adapter type -> credential profile name
const CREDENTIAL_PROFILE_FOR: Record<string, string> = {
    mysql: 'Test MySQL/MariaDB Credentials',
    mariadb: 'Test MySQL/MariaDB Credentials',
    postgres: 'Test PostgreSQL Credentials',
    mongodb: 'Test MongoDB Credentials',
    mssql: 'Test MSSQL Credentials',
    redis: 'Test Redis Credentials',
    valkey: 'Test Redis Credentials',
};

// Inline config fields that the credential profile now owns
const CREDENTIAL_FIELDS = new Set(['user', 'username', 'password']);

// ---------------------------------------------------------------------------

async function upsertCredentialProfile(def: CredentialProfileDef): Promise<string> {
    const encryptedData = encrypt(JSON.stringify(def.data));

    const existing = await prisma.credentialProfile.findFirst({ where: { name: def.name } });
    if (existing) {
        await prisma.credentialProfile.update({
            where: { id: existing.id },
            data: { data: encryptedData, description: def.description },
        });
        console.log(`  - "${def.name}" updated`);
        return existing.id;
    }

    const created = await prisma.credentialProfile.create({
        data: {
            name: def.name,
            type: def.type,
            data: encryptedData,
            description: def.description,
        },
    });
    console.log(`  - "${def.name}" created`);
    return created.id;
}

async function main() {
    console.log('🌱 Seeding test database sources...');

    // Step 1 - upsert credential profiles
    console.log('\n📋 Upserting credential profiles...');
    const profileIdByName: Record<string, string> = {};
    for (const def of CREDENTIAL_PROFILES) {
        profileIdByName[def.name] = await upsertCredentialProfile(def);
    }

    // Step 2 - upsert adapter configs (credentials stripped, profileId set)
    console.log('\n🗄️  Upserting adapter configs...');
    for (const db of testDatabases) {
        console.log(`Adding ${db.name}...`);

        const profileName = CREDENTIAL_PROFILE_FOR[db.config.type];
        const primaryCredentialId = profileName ? profileIdByName[profileName] : null;

        // Strip inline credential fields - these are now owned by the profile
        const cleanConfig: Record<string, unknown> = Object.fromEntries(
            Object.entries(db.config).filter(([k]) => !CREDENTIAL_FIELDS.has(k))
        );
        cleanConfig.connectionMode = 'direct';

        const existing = await prisma.adapterConfig.findFirst({ where: { name: db.name } });
        if (existing) {
            console.log(`  - ${db.name} already exists, updating...`);
            await prisma.adapterConfig.update({
                where: { id: existing.id },
                data: {
                    config: JSON.stringify(cleanConfig),
                    adapterId: db.config.type,
                    type: 'database',
                    primaryCredentialId,
                },
            });
        } else {
            await prisma.adapterConfig.create({
                data: {
                    name: db.name,
                    type: 'database',
                    adapterId: db.config.type,
                    config: JSON.stringify(cleanConfig),
                    primaryCredentialId,
                },
            });
            console.log(`  - ${db.name} created`);
        }
    }

    console.log('\n✅ Seeding complete.');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
