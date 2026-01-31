// Script to initialize MSSQL test databases
const sql = require('mssql');

const configs = [
    { name: 'MSSQL 2022', port: 14342 },
    { name: 'MSSQL 2019', port: 14339 },
    { name: 'Azure SQL Edge', port: 14350 },
];

async function initDatabase(name, port) {
    let pool = null;
    try {
        pool = await sql.connect({
            server: 'localhost',
            port: port,
            user: 'sa',
            password: 'YourStrong!Passw0rd',
            database: 'master',
            options: { encrypt: true, trustServerCertificate: true, connectTimeout: 10000 }
        });
        console.log(`✓ Connected to ${name} (port ${port})`);

        // Create testdb if not exists
        await pool.request().query("IF NOT EXISTS (SELECT * FROM sys.databases WHERE name = 'testdb') CREATE DATABASE testdb");
        console.log(`  - testdb created/verified`);

        // Add some test data
        await pool.request().query("USE testdb; IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'test_table') CREATE TABLE test_table (id INT PRIMARY KEY, name NVARCHAR(50))");
        await pool.request().query("USE testdb; IF NOT EXISTS (SELECT * FROM test_table WHERE id = 1) INSERT INTO test_table VALUES (1, 'test')");
        console.log(`  - Test data added`);

        await pool.close();
        return true;
    } catch (e) {
        console.error(`✗ ${name}: ${e.message}`);
        if (pool) await pool.close();
        return false;
    }
}

async function main() {
    console.log('🔧 Initializing MSSQL test databases...\n');

    let success = 0;
    for (const cfg of configs) {
        if (await initDatabase(cfg.name, cfg.port)) {
            success++;
        }
    }

    console.log(`\n✅ ${success}/${configs.length} databases initialized`);
    process.exit(success === configs.length ? 0 : 1);
}

main();
