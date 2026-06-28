#!/bin/bash
# Setup testdb database for MSSQL containers
# This script creates the testdb database if it doesn't exist

set -e

MSSQL_PASSWORD="YourStrong!Passw0rd"

# Function to create testdb on a MSSQL container
create_testdb() {
    local container_name=$1

    echo "  → Setting up $container_name..."

    # Check if container is running
    if ! docker ps --format '{{.Names}}' | grep -q "^${container_name}$"; then
        echo "    ⚠️  Container $container_name is not running, skipping..."
        return
    fi

    # Find sqlcmd path (different versions have different paths)
    local sqlcmd_path
    sqlcmd_path=$(docker exec "$container_name" find /opt -name "sqlcmd" 2>/dev/null | head -1)

    if [ -z "$sqlcmd_path" ]; then
        echo "    ⚠️  No sqlcmd found in $container_name, skipping..."
        return
    fi

    # Create testdb if it doesn't exist
    docker exec "$container_name" "$sqlcmd_path" \
        -S localhost \
        -U sa \
        -P "$MSSQL_PASSWORD" \
        -C \
        -Q "IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = 'testdb') CREATE DATABASE testdb; SELECT 'OK' AS status;" \
        -b 2>/dev/null || {
            echo "    ⚠️  Failed to create testdb on $container_name"
            return
        }

    echo "    ✓ testdb ready on $container_name"
}

echo "🔧 Setting up MSSQL test databases..."

# All MSSQL containers (script auto-detects sqlcmd path)
create_testdb "dbm-test-mssql-2019"
create_testdb "dbm-test-mssql-2022"
# create_testdb "dbm-test-mssql-edge"  # disabled to reduce RAM usage

echo "✓ MSSQL setup complete"
