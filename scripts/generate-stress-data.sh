#!/bin/bash
#
# Stress Test Data Generator
#
# Generates ~1.5GB of test data in each database type to test
# backup/restore performance with larger datasets.
#
# Usage:
#   pnpm run test:stress:generate           # All databases
#   pnpm run test:stress:generate mysql     # Only MySQL/MariaDB
#   pnpm run test:stress:generate postgres  # Only PostgreSQL
#   pnpm run test:stress:generate mongodb   # Only MongoDB
#   pnpm run test:stress:generate mssql     # Only MSSQL
#
# Environment:
#   TARGET_SIZE_MB=1500  # Target size per database (default: 1500)

set -e

TARGET_SIZE_MB=${TARGET_SIZE_MB:-1500}
DB_FILTER=${1:-all}

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║           🔥 STRESS TEST DATA GENERATOR 🔥                     ║${NC}"
echo -e "${BLUE}╠════════════════════════════════════════════════════════════════╣${NC}"
echo -e "${BLUE}║  Target size per DB: ~${TARGET_SIZE_MB} MB                               ║${NC}"
echo -e "${BLUE}║  Filter: ${DB_FILTER}                                                    ║${NC}"
echo -e "${BLUE}║  This will take several minutes per database.                  ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Calculate row count (~1KB per row)
ROWS_PER_MB=1000
TOTAL_ROWS=$((TARGET_SIZE_MB * ROWS_PER_MB))
BATCH_SIZE=10000

echo "📊 Will generate approximately ${TOTAL_ROWS} rows per database"
echo ""

# ==================== MySQL ====================
populate_mysql() {
    local CONTAINER=$1
    local NAME=$2
    local DB_NAME="testdb"
    local CLI_CMD=${3:-mysql}  # mysql or mariadb

    echo -e "\n${YELLOW}📊 Populating ${NAME}...${NC}"

    # Create database
    docker exec -i ${CONTAINER} ${CLI_CMD} -uroot -prootpassword -e "DROP DATABASE IF EXISTS ${DB_NAME}; CREATE DATABASE ${DB_NAME};" 2>/dev/null

    # Create table
    docker exec -i ${CONTAINER} ${CLI_CMD} -uroot -prootpassword ${DB_NAME} <<EOF
CREATE TABLE stress_data (
    id INT PRIMARY KEY AUTO_INCREMENT,
    uuid VARCHAR(100) NOT NULL,
    name VARCHAR(200) NOT NULL,
    email VARCHAR(200) NOT NULL,
    description TEXT,
    data_blob TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20),
    amount DECIMAL(10,2),
    INDEX idx_uuid (uuid),
    INDEX idx_status (status)
) ENGINE=InnoDB;
EOF

    # Generate data using stored procedure for speed
    docker exec -i ${CONTAINER} ${CLI_CMD} -uroot -prootpassword ${DB_NAME} <<EOF
DELIMITER //
CREATE PROCEDURE generate_data(IN num_rows INT)
BEGIN
    DECLARE i INT DEFAULT 0;
    DECLARE batch INT DEFAULT 0;

    SET autocommit = 0;

    WHILE i < num_rows DO
        INSERT INTO stress_data (uuid, name, email, description, data_blob, status, amount)
        VALUES (
            UUID(),
            CONCAT('User ', i, ' - ', REPEAT(CHAR(65 + FLOOR(RAND() * 26)), 50)),
            CONCAT('user', i, '@stress-test-', SUBSTRING(MD5(RAND()), 1, 10), '.com'),
            REPEAT(CHAR(65 + FLOOR(RAND() * 26)), 200),
            REPEAT(CHAR(65 + FLOOR(RAND() * 26)), 500),
            ELT(1 + FLOOR(RAND() * 3), 'active', 'pending', 'inactive'),
            ROUND(RAND() * 10000, 2)
        );

        SET i = i + 1;
        SET batch = batch + 1;

        IF batch >= 10000 THEN
            COMMIT;
            SET batch = 0;
            SELECT CONCAT('  Progress: ', ROUND(i / num_rows * 100, 1), '% (', i, ' rows)') AS status;
        END IF;
    END WHILE;

    COMMIT;
END //
DELIMITER ;

CALL generate_data(${TOTAL_ROWS});
DROP PROCEDURE generate_data;
EOF

    # Show size
    SIZE=$(docker exec ${CONTAINER} ${CLI_CMD} -uroot -prootpassword -N -e \
        "SELECT ROUND(((data_length + index_length) / 1024 / 1024), 2) FROM information_schema.tables WHERE table_schema='${DB_NAME}' AND table_name='stress_data';" 2>/dev/null)
    echo -e "   ${GREEN}✅ Done! Table size: ${SIZE} MB${NC}"
}

# ==================== PostgreSQL ====================
populate_postgres() {
    local CONTAINER=$1
    local NAME=$2
    local DB_NAME="testdb"

    echo -e "\n${YELLOW}📊 Populating ${NAME}...${NC}"

    # Create database
    docker exec -i ${CONTAINER} psql -U testuser -d postgres -c "DROP DATABASE IF EXISTS ${DB_NAME};" 2>/dev/null
    docker exec -i ${CONTAINER} psql -U testuser -d postgres -c "CREATE DATABASE ${DB_NAME};" 2>/dev/null

    # Create table and generate data
    docker exec -i ${CONTAINER} psql -U testuser -d ${DB_NAME} <<EOF
CREATE TABLE stress_data (
    id SERIAL PRIMARY KEY,
    uuid VARCHAR(100) NOT NULL,
    name VARCHAR(200) NOT NULL,
    email VARCHAR(200) NOT NULL,
    description TEXT,
    data_blob TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20),
    amount DECIMAL(10,2)
);

CREATE INDEX idx_uuid ON stress_data(uuid);
CREATE INDEX idx_status ON stress_data(status);

-- Generate data using generate_series
INSERT INTO stress_data (uuid, name, email, description, data_blob, status, amount)
SELECT
    gen_random_uuid()::text,
    'User ' || i || ' - ' || repeat(chr(65 + (random() * 25)::int), 50),
    'user' || i || '@stress-test-' || substr(md5(random()::text), 1, 10) || '.com',
    repeat(chr(65 + (random() * 25)::int), 200),
    repeat(chr(65 + (random() * 25)::int), 500),
    (ARRAY['active', 'pending', 'inactive'])[1 + (random() * 2)::int],
    round((random() * 10000)::numeric, 2)
FROM generate_series(1, ${TOTAL_ROWS}) AS i;

VACUUM ANALYZE stress_data;
EOF

    # Show size
    SIZE=$(docker exec ${CONTAINER} psql -U testuser -d ${DB_NAME} -t -c \
        "SELECT pg_size_pretty(pg_total_relation_size('stress_data'));" 2>/dev/null | xargs)
    echo -e "   ${GREEN}✅ Done! Table size: ${SIZE}${NC}"
}

# ==================== MongoDB ====================
populate_mongodb() {
    local CONTAINER=$1
    local NAME=$2
    local DB_NAME="testdb"

    echo -e "\n${YELLOW}📊 Populating ${NAME}...${NC}"

    # Generate data using mongosh
    docker exec -i ${CONTAINER} mongosh --quiet -u root -p rootpassword --authenticationDatabase admin <<EOF
use ${DB_NAME}
db.stress_data.drop()

// Generate data in batches
const totalRows = ${TOTAL_ROWS};
const batchSize = 10000;
let inserted = 0;

function randomString(length) {
    let result = '';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

while (inserted < totalRows) {
    const batch = [];
    const count = Math.min(batchSize, totalRows - inserted);

    for (let i = 0; i < count; i++) {
        batch.push({
            _id: inserted + i + 1,
            uuid: UUID().toString(),
            name: 'User ' + (inserted + i) + ' - ' + randomString(50),
            email: 'user' + (inserted + i) + '@stress-test-' + randomString(10) + '.com',
            description: randomString(200),
            data_blob: randomString(500),
            created_at: new Date(),
            updated_at: new Date(),
            status: ['active', 'pending', 'inactive'][Math.floor(Math.random() * 3)],
            amount: Math.round(Math.random() * 1000000) / 100
        });
    }

    db.stress_data.insertMany(batch, { ordered: false });
    inserted += count;

    if (inserted % 100000 === 0 || inserted >= totalRows) {
        print('  Progress: ' + Math.round(inserted / totalRows * 100) + '% (' + inserted + ' docs)');
    }
}

// Create indexes
db.stress_data.createIndex({ uuid: 1 });
db.stress_data.createIndex({ status: 1 });

// Show stats
const stats = db.stress_data.stats();
print('Collection size: ' + Math.round(stats.storageSize / 1024 / 1024) + ' MB');
EOF

    echo -e "   ${GREEN}✅ Done!${NC}"
}

# ==================== MSSQL ====================
populate_mssql() {
    local CONTAINER=$1
    local NAME=$2
    local DB_NAME="testdb"

    echo -e "\n${YELLOW}📊 Populating ${NAME}...${NC}"

    # Create database and table, generate data
    docker exec -i ${CONTAINER} /opt/mssql-tools18/bin/sqlcmd -C -S localhost -U sa -P 'YourStrong!Passw0rd' -Q "
IF EXISTS (SELECT name FROM sys.databases WHERE name = '${DB_NAME}')
BEGIN
    ALTER DATABASE [${DB_NAME}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    DROP DATABASE [${DB_NAME}];
END
CREATE DATABASE [${DB_NAME}];
" 2>/dev/null

    docker exec -i ${CONTAINER} /opt/mssql-tools18/bin/sqlcmd -C -S localhost -U sa -P 'YourStrong!Passw0rd' -d ${DB_NAME} -Q "
CREATE TABLE stress_data (
    id INT IDENTITY(1,1) PRIMARY KEY,
    uuid VARCHAR(100) NOT NULL,
    name VARCHAR(200) NOT NULL,
    email VARCHAR(200) NOT NULL,
    description VARCHAR(MAX),
    data_blob VARCHAR(MAX),
    created_at DATETIME2 DEFAULT GETDATE(),
    updated_at DATETIME2 DEFAULT GETDATE(),
    status VARCHAR(20),
    amount DECIMAL(10,2)
);
CREATE INDEX idx_uuid ON stress_data(uuid);
CREATE INDEX idx_status ON stress_data(status);
" 2>/dev/null

    # Generate data using a loop with batches
    # MSSQL is slower so we use smaller total for now
    local MSSQL_ROWS=$((TOTAL_ROWS / 2))  # Reduced for MSSQL due to speed

    echo "   Generating ${MSSQL_ROWS} rows (reduced for MSSQL performance)..."

    docker exec -i ${CONTAINER} /opt/mssql-tools18/bin/sqlcmd -C -S localhost -U sa -P 'YourStrong!Passw0rd' -d ${DB_NAME} -Q "
SET NOCOUNT ON;
DECLARE @i INT = 0;
DECLARE @batch INT = 0;

WHILE @i < ${MSSQL_ROWS}
BEGIN
    INSERT INTO stress_data (uuid, name, email, description, data_blob, status, amount)
    VALUES (
        NEWID(),
        CONCAT('User ', @i, ' - ', REPLICATE(CHAR(65 + ABS(CHECKSUM(NEWID())) % 26), 50)),
        CONCAT('user', @i, '@stress-test-', SUBSTRING(CONVERT(VARCHAR(36), NEWID()), 1, 10), '.com'),
        REPLICATE(CHAR(65 + ABS(CHECKSUM(NEWID())) % 26), 200),
        REPLICATE(CHAR(65 + ABS(CHECKSUM(NEWID())) % 26), 500),
        CASE ABS(CHECKSUM(NEWID())) % 3 WHEN 0 THEN 'active' WHEN 1 THEN 'pending' ELSE 'inactive' END,
        CAST(RAND(CHECKSUM(NEWID())) * 10000 AS DECIMAL(10,2))
    );

    SET @i = @i + 1;
    SET @batch = @batch + 1;

    IF @batch >= 10000
    BEGIN
        PRINT CONCAT('  Progress: ', CAST(@i * 100 / ${MSSQL_ROWS} AS VARCHAR), '%');
        SET @batch = 0;
    END
END
" 2>/dev/null

    # Show size
    SIZE=$(docker exec ${CONTAINER} /opt/mssql-tools18/bin/sqlcmd -C -S localhost -U sa -P 'YourStrong!Passw0rd' -d ${DB_NAME} -h -1 -Q "
SET NOCOUNT ON;
SELECT CAST(ROUND(((SUM(a.total_pages) * 8) / 1024.00), 2) AS VARCHAR)
FROM sys.tables t
INNER JOIN sys.indexes i ON t.object_id = i.object_id
INNER JOIN sys.partitions p ON i.object_id = p.object_id AND i.index_id = p.index_id
INNER JOIN sys.allocation_units a ON p.partition_id = a.container_id
WHERE t.name = 'stress_data';
" 2>/dev/null | tr -d '[:space:]')
    echo -e "   ${GREEN}✅ Done! Table size: ${SIZE} MB${NC}"
}

# ==================== Main ====================

START_TIME=$(date +%s)

# MySQL / MariaDB
if [ "$DB_FILTER" = "all" ] || [ "$DB_FILTER" = "mysql" ]; then
    populate_mysql "dbm-test-mysql-8" "MySQL 8.0" "mysql"
    populate_mysql "dbm-test-mariadb-11" "MariaDB 11" "mariadb"
fi

# PostgreSQL
if [ "$DB_FILTER" = "all" ] || [ "$DB_FILTER" = "postgres" ]; then
    populate_postgres "dbm-test-pg-16" "PostgreSQL 16"
fi

# MongoDB
if [ "$DB_FILTER" = "all" ] || [ "$DB_FILTER" = "mongodb" ]; then
    populate_mongodb "dbm-test-mongo-7" "MongoDB 7.0"
fi

# MSSQL
if [ "$DB_FILTER" = "all" ] || [ "$DB_FILTER" = "mssql" ]; then
    populate_mssql "dbm-test-mssql-2022" "MSSQL 2022"
fi

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

echo ""
echo -e "${BLUE}══════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}                           SUMMARY                                 ${NC}"
echo -e "${BLUE}══════════════════════════════════════════════════════════════════${NC}"
echo -e "  Total time: $((DURATION / 60)) minutes $((DURATION % 60)) seconds"
echo -e "${BLUE}══════════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${GREEN}✅ Stress test databases are ready!${NC}"
echo ""
echo "You can now test backup/restore with large datasets:"
echo "  1. Seed sources:  pnpm run test:seed"
echo "  2. Open UI:       pnpm run dev"
echo "  3. Select 'testdb' database for backup jobs"
