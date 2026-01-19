// Shared configuration for Integration Tests and Seeding
export const testDatabases = [
    // --- MySQL ---
    {
        name: 'Test MySQL 5.7',
        config: { type: 'mysql', host: 'localhost', port: 33357, user: 'root', password: 'rootpassword', database: 'testdb' }
    },
    {
        name: 'Test MySQL 8.0',
        config: { type: 'mysql', host: 'localhost', port: 33380, user: 'root', password: 'rootpassword', database: 'testdb' }
    },
    {
        name: 'Test MySQL 9.x',
        config: { type: 'mysql', host: 'localhost', port: 33390, user: 'root', password: 'rootpassword', database: 'testdb' }
    },
    // --- MariaDB ---
    {
        name: 'Test MariaDB 10',
        config: { type: 'mariadb', host: 'localhost', port: 33310, user: 'root', password: 'rootpassword', database: 'testdb' }
    },
    {
        name: 'Test MariaDB 11',
        config: { type: 'mariadb', host: 'localhost', port: 33311, user: 'root', password: 'rootpassword', database: 'testdb' }
    },
    // --- PostgreSQL ---
    {
        name: 'Test PostgreSQL 12',
        config: { type: 'postgres', host: 'localhost', port: 54412, user: 'testuser', password: 'testpassword', database: 'testdb' }
    },
    {
        name: 'Test PostgreSQL 13',
        config: { type: 'postgres', host: 'localhost', port: 54413, user: 'testuser', password: 'testpassword', database: 'testdb' }
    },
    {
        name: 'Test PostgreSQL 14',
        config: { type: 'postgres', host: 'localhost', port: 54414, user: 'testuser', password: 'testpassword', database: 'testdb' }
    },
    {
        name: 'Test PostgreSQL 15',
        config: { type: 'postgres', host: 'localhost', port: 54415, user: 'testuser', password: 'testpassword', database: 'testdb' }
    },
    {
        name: 'Test PostgreSQL 16',
        config: { type: 'postgres', host: 'localhost', port: 54416, user: 'testuser', password: 'testpassword', database: 'testdb' }
    },
    {
        name: 'Test PostgreSQL 17',
        config: { type: 'postgres', host: 'localhost', port: 54417, user: 'testuser', password: 'testpassword', database: 'testdb' }
    },
    // --- MongoDB ---
    {
        name: 'Test MongoDB 4.4',
        config: { type: 'mongodb', host: 'localhost', port: 27704, user: 'root', password: 'rootpassword', database: 'testdb' }
    },
    {
        name: 'Test MongoDB 5.0',
        config: { type: 'mongodb', host: 'localhost', port: 27705, user: 'root', password: 'rootpassword', database: 'testdb' }
    },
    {
        name: 'Test MongoDB 6.0',
        config: { type: 'mongodb', host: 'localhost', port: 27706, user: 'root', password: 'rootpassword', database: 'testdb' }
    },
    {
        name: 'Test MongoDB 7.0',
        config: { type: 'mongodb', host: 'localhost', port: 27707, user: 'root', password: 'rootpassword', database: 'testdb' }
    },
    {
        name: 'Test MongoDB 8.0',
        config: { type: 'mongodb', host: 'localhost', port: 27708, user: 'root', password: 'rootpassword', database: 'testdb' }
    }
];
