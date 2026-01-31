// Shared configuration for Integration Tests and Seeding
const TEST_HOST = process.env.TEST_DB_HOST || 'localhost';

// Test database: testdb (use pnpm run test:stress:generate to populate with ~1.5GB of data)
export const testDatabases = [
    // --- MySQL ---
    {
        name: 'Test MySQL 5.7',
        config: { type: 'mysql', host: TEST_HOST, port: 33357, user: 'root', password: 'rootpassword', database: 'testdb' }
    },
    {
        name: 'Test MySQL 8.0',
        config: { type: 'mysql', host: TEST_HOST, port: 33380, user: 'root', password: 'rootpassword', database: 'testdb' }
    },
    {
        name: 'Test MySQL 9.x',
        config: { type: 'mysql', host: TEST_HOST, port: 33390, user: 'root', password: 'rootpassword', database: 'testdb' }
    },
    // --- MariaDB ---
    {
        name: 'Test MariaDB 10',
        config: { type: 'mariadb', host: TEST_HOST, port: 33310, user: 'root', password: 'rootpassword', database: 'testdb' }
    },
    {
        name: 'Test MariaDB 11',
        config: { type: 'mariadb', host: TEST_HOST, port: 33311, user: 'root', password: 'rootpassword', database: 'testdb' }
    },
    // --- PostgreSQL ---
    {
        name: 'Test PostgreSQL 12',
        config: { type: 'postgres', host: TEST_HOST, port: 54412, user: 'testuser', password: 'testpassword', database: 'testdb' }
    },
    {
        name: 'Test PostgreSQL 13',
        config: { type: 'postgres', host: TEST_HOST, port: 54413, user: 'testuser', password: 'testpassword', database: 'testdb' }
    },
    {
        name: 'Test PostgreSQL 14',
        config: { type: 'postgres', host: TEST_HOST, port: 54414, user: 'testuser', password: 'testpassword', database: 'testdb' }
    },
    {
        name: 'Test PostgreSQL 15',
        config: { type: 'postgres', host: TEST_HOST, port: 54415, user: 'testuser', password: 'testpassword', database: 'testdb' }
    },
    {
        name: 'Test PostgreSQL 16',
        config: { type: 'postgres', host: TEST_HOST, port: 54416, user: 'testuser', password: 'testpassword', database: 'testdb' }
    },
    {
        name: 'Test PostgreSQL 17',
        config: { type: 'postgres', host: TEST_HOST, port: 54417, user: 'testuser', password: 'testpassword', database: 'testdb' }
    },
    // --- MongoDB ---
    {
        name: 'Test MongoDB 4.4',
        config: { type: 'mongodb', host: TEST_HOST, port: 27704, user: 'root', password: 'rootpassword', database: 'testdb' }
    },
    {
        name: 'Test MongoDB 5.0',
        config: { type: 'mongodb', host: TEST_HOST, port: 27705, user: 'root', password: 'rootpassword', database: 'testdb' }
    },
    {
        name: 'Test MongoDB 6.0',
        config: { type: 'mongodb', host: TEST_HOST, port: 27706, user: 'root', password: 'rootpassword', database: 'testdb' }
    },
    {
        name: 'Test MongoDB 7.0',
        config: { type: 'mongodb', host: TEST_HOST, port: 27707, user: 'root', password: 'rootpassword', database: 'testdb' }
    },
    {
        name: 'Test MongoDB 8.0',
        config: { type: 'mongodb', host: TEST_HOST, port: 27708, user: 'root', password: 'rootpassword', database: 'testdb' }
    },
    // --- Microsoft SQL Server ---
    // MSSQL backups are created on the server filesystem via T-SQL BACKUP DATABASE.
    // We mount /tmp to /var/opt/mssql/backup so backups are directly accessible.
    {
        name: 'Test MSSQL 2019',
        config: {
            type: 'mssql',
            host: TEST_HOST,
            port: 14339,
            user: 'sa',
            password: 'YourStrong!Passw0rd',
            database: 'testdb',
            encrypt: true,
            trustServerCertificate: true,
            backupPath: '/var/opt/mssql/backup',
            localBackupPath: '/tmp'
        }
    },
    {
        name: 'Test MSSQL 2022',
        config: {
            type: 'mssql',
            host: TEST_HOST,
            port: 14342,
            user: 'sa',
            password: 'YourStrong!Passw0rd',
            database: 'testdb',
            encrypt: true,
            trustServerCertificate: true,
            backupPath: '/var/opt/mssql/backup',
            localBackupPath: '/tmp'
        }
    },
    {
        name: 'Test Azure SQL Edge',
        config: {
            type: 'mssql',
            host: TEST_HOST,
            port: 14350,
            user: 'sa',
            password: 'YourStrong!Passw0rd',
            database: 'testdb',
            encrypt: true,
            trustServerCertificate: true,
            backupPath: '/var/opt/mssql/backup',
            localBackupPath: '/tmp'
        }
    }
];
