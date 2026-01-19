#!/bin/bash
set -e

echo "🐳 Starting Test Database Containers..."
docker compose -f docker-compose.test.yml up -d

echo "⏳ Waiting for databases to be healthy..."
# A simple wait loop or just wait for specific healthchecks
# Since we defined healthchecks in docker-compose, we can wait for them.

# Docker Compose V2
docker compose -f docker-compose.test.yml ps

echo "⚠️  Note: If this is the first run, databases might take a few seconds to initialize even after container start."
echo "sleeping 30s to allow all 16 DBs to initialize..."
sleep 30

echo "🧪 Running Integration Tests..."
npm run test:integration:run

echo "🧹 Teardown..."
docker compose -f docker-compose.test.yml down
