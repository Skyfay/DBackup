
import { PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Load .env if present so ENCRYPTION_KEY is available for credential encryption.
// Falls back silently if the file does not exist (e.g. env vars already set in CI).
try {
    process.loadEnvFile('.env');
} catch {
    // .env not found - ENCRYPTION_KEY must be set in the environment already
}

import { encrypt } from '../src/lib/crypto';

const prisma = new PrismaClient();

const VM_NAME = process.env.VM_NAME || 'dbackup-test-vm';
const SSH_USERNAME = 'ubuntu';
const REMOTE_PATH = '/home/ubuntu/dbackup-test';
const KEY_PATH = join(homedir(), '.dbackup-test-vm', 'id_ed25519');

// ---------------------------------------------------------------------------
// Primary (non-SSH) credential profiles the SSH-mode sources authenticate
// with against the database engine itself - same profiles/values test-seed.ts
// creates, upserted here too so this script works standalone.
// ---------------------------------------------------------------------------

interface UsernamePasswordProfileDef {
    name: string;
    description: string;
    data: { username: string; password: string };
}

const DB_CREDENTIAL_PROFILES: UsernamePasswordProfileDef[] = [
    {
        name: 'Test MySQL/MariaDB Credentials',
        description: 'Root credentials for MySQL/MariaDB test containers',
        data: { username: 'root', password: 'rootpassword' },
    },
    {
        name: 'Test PostgreSQL Credentials',
        description: 'Credentials for PostgreSQL test containers',
        data: { username: 'testuser', password: 'testpassword' },
    },
    {
        name: 'Test Redis Credentials',
        description: 'Credentials for Redis/Valkey test containers',
        data: { username: 'default', password: 'testpassword' },
    },
    {
        name: 'Test MongoDB Credentials',
        description: 'Root credentials for MongoDB test containers',
        data: { username: 'root', password: 'rootpassword' },
    },
    {
        name: 'Test Firebird Credentials',
        description: 'SYSDBA credentials for Firebird test containers',
        data: { username: 'SYSDBA', password: 'masterkey' },
    },
];

// ---------------------------------------------------------------------------
// SSH-mode database sources.
//
// "SSH mode" execs the dump binary directly ON the VM (mysqldump/pg_dump/
// redis-cli/mongodump/gbak), so `host`/`port` point at 127.0.0.1 + the
// container's published port AS SEEN FROM THE VM - the app itself never
// opens a TCP connection to the DB engine, only an SSH connection to the VM.
// Requires the matching client tool on the VM (installed by test-vm-up.sh's
// cloud-init: mariadb-client, postgresql-client, redis-tools, mongodb-database-tools).
//
// MSSQL is intentionally NOT included for now: unlike the others, its SSH
// mode still makes a direct TDS connection from the app (only the resulting
// .bak file is fetched via SFTP), and it's by far the heaviest container -
// see test-vm-up.sh for how to add it back if you need it.
// ---------------------------------------------------------------------------

interface SshDbSourceDef {
    name: string;
    adapterId: string;
    credentialProfile: string;
    config: Record<string, unknown>;
}

function sshDbSources(vmHost: string): SshDbSourceDef[] {
    return [
        {
            name: 'SSH Test MySQL 9',
            adapterId: 'mysql',
            credentialProfile: 'Test MySQL/MariaDB Credentials',
            config: { host: '127.0.0.1', port: 33390, database: 'testdb', connectionMode: 'ssh', sshHost: vmHost, sshPort: 22 },
        },
        {
            name: 'SSH Test MariaDB 11',
            adapterId: 'mariadb',
            credentialProfile: 'Test MySQL/MariaDB Credentials',
            config: { host: '127.0.0.1', port: 33311, database: 'testdb', connectionMode: 'ssh', sshHost: vmHost, sshPort: 22 },
        },
        {
            // Deliberately targets postgres-12, not postgres-17: the VM's apt
            // postgresql-client is v16, and pg_dump cannot dump FROM a newer
            // major version than itself.
            name: 'SSH Test PostgreSQL 12',
            adapterId: 'postgres',
            credentialProfile: 'Test PostgreSQL Credentials',
            config: { host: '127.0.0.1', port: 54412, database: 'testdb', connectionMode: 'ssh', sshHost: vmHost, sshPort: 22 },
        },
        {
            name: 'SSH Test Redis 8',
            adapterId: 'redis',
            credentialProfile: 'Test Redis Credentials',
            config: { host: '127.0.0.1', port: 63798, database: 0, connectionMode: 'ssh', sshHost: vmHost, sshPort: 22 },
        },
        {
            name: 'SSH Test Valkey 8',
            adapterId: 'valkey',
            credentialProfile: 'Test Redis Credentials',
            config: { host: '127.0.0.1', port: 63780, database: 0, connectionMode: 'ssh', sshHost: vmHost, sshPort: 22 },
        },
        {
            name: 'SSH Test MongoDB 8',
            adapterId: 'mongodb',
            credentialProfile: 'Test MongoDB Credentials',
            config: { host: '127.0.0.1', port: 27708, database: 'testdb', connectionMode: 'ssh', sshHost: vmHost, sshPort: 22 },
        },
        {
            // Firebird's connection string is always "host[/port]:path" - even in
            // SSH mode, gbak still needs the network protocol to reach a server
            // running inside a container (a bare local path only works when gbak
            // and the engine share the same host/network namespace, which a
            // container never does with the VM).
            name: 'SSH Test Firebird 5.0',
            adapterId: 'firebird',
            credentialProfile: 'Test Firebird Credentials',
            config: {
                host: '127.0.0.1',
                port: 31550,
                databases: [{ name: 'testdb', path: '/var/lib/firebird/data/testdb.fdb' }],
                database: 'testdb',
                connectionMode: 'ssh',
                sshHost: vmHost,
                sshPort: 22,
            },
        },
    ];
}

// ---------------------------------------------------------------------------

function resolveVmHost(): string {
    if (process.env.TEST_VM_HOST) return process.env.TEST_VM_HOST;

    try {
        const output = execSync(`multipass info ${VM_NAME}`, { encoding: 'utf-8' });
        const match = output.match(/^IPv4:\s*(\S+)/m);
        if (match) return match[1];
    } catch {
        // fall through to the error below
    }

    throw new Error(
        `Could not determine the test VM's IP address. Run "pnpm run test:vm:up" first, or set TEST_VM_HOST manually.`
    );
}

function loadPrivateKey(): string {
    if (!existsSync(KEY_PATH)) {
        throw new Error(`SSH key not found at ${KEY_PATH}. Run "pnpm run test:vm:up" first - it generates this key.`);
    }
    return readFileSync(KEY_PATH, 'utf-8');
}

async function upsertCredentialProfile(name: string, type: string, description: string, data: Record<string, unknown>): Promise<string> {
    const encryptedData = encrypt(JSON.stringify(data));

    const existing = await prisma.credentialProfile.findFirst({ where: { name } });
    if (existing) {
        await prisma.credentialProfile.update({
            where: { id: existing.id },
            data: { data: encryptedData, description },
        });
        console.log(`  - "${name}" updated`);
        return existing.id;
    }

    const created = await prisma.credentialProfile.create({
        data: { name, type, data: encryptedData, description },
    });
    console.log(`  - "${name}" created`);
    return created.id;
}

async function upsertAdapterConfig(
    name: string,
    type: 'database' | 'storage',
    adapterId: string,
    config: Record<string, unknown>,
    primaryCredentialId: string | null,
    sshCredentialId: string | null = null
): Promise<void> {
    const existing = await prisma.adapterConfig.findFirst({ where: { name } });
    if (existing) {
        await prisma.adapterConfig.update({
            where: { id: existing.id },
            data: { config: JSON.stringify(config), adapterId, type, primaryCredentialId, sshCredentialId },
        });
        console.log(`  - "${name}" updated`);
    } else {
        await prisma.adapterConfig.create({
            data: { name, type, adapterId, config: JSON.stringify(config), primaryCredentialId, sshCredentialId },
        });
        console.log(`  - "${name}" created`);
    }
}

async function main() {
    console.log('🌱 Seeding SSH test config...');

    const vmHost = resolveVmHost();
    const privateKey = loadPrivateKey();
    console.log(`\n📡 Using test VM at ${vmHost}`);

    console.log('\n📋 Upserting SSH credential profile...');
    const sshKeyProfileId = await upsertCredentialProfile(
        'Test VM SSH Credentials',
        'SSH_KEY',
        `SSH key for the local Multipass test VM (${VM_NAME})`,
        { username: SSH_USERNAME, authType: 'privateKey', privateKey }
    );

    console.log('\n📋 Upserting database credential profiles...');
    const dbCredentialIds: Record<string, string> = {};
    for (const def of DB_CREDENTIAL_PROFILES) {
        dbCredentialIds[def.name] = await upsertCredentialProfile(def.name, 'USERNAME_PASSWORD', def.description, def.data);
    }

    // DB sources use the SSH_KEY profile in the "ssh" slot (they keep their own
    // primary DB credential); SFTP/Rsync use it in the "primary" slot (it IS
    // their only credential) - see credential-requirements.ts.
    console.log('\n🗄️  Upserting SSH-mode database sources...');
    for (const source of sshDbSources(vmHost)) {
        await upsertAdapterConfig(
            source.name,
            'database',
            source.adapterId,
            source.config,
            dbCredentialIds[source.credentialProfile],
            sshKeyProfileId
        );
    }

    console.log('\n🗄️  Upserting SSH-mode storage destinations...');
    await upsertAdapterConfig(
        'Test VM SFTP',
        'storage',
        'sftp',
        { host: vmHost, port: 22, pathPrefix: REMOTE_PATH },
        sshKeyProfileId
    );
    await upsertAdapterConfig(
        'Test VM Rsync',
        'storage',
        'rsync',
        { host: vmHost, port: 22, pathPrefix: REMOTE_PATH, options: '' },
        sshKeyProfileId
    );

    console.log('\n✅ Seeding complete.');
    console.log('   Note: MSSQL is not seeded for now - see comments in this script for why.');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
