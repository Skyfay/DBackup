#!/bin/bash

# Color codes
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Starting Database Backup Manager development setup for macOS...${NC}"

# Check for Homebrew
if ! command -v brew &> /dev/null; then
    echo -e "${RED}Homebrew is not installed. Please install it first: https://brew.sh/${NC}"
    exit 1
fi

echo -e "${GREEN}Updating Homebrew...${NC}"
brew update

echo -e "${GREEN}Installing MySQL Client (mysqldump, mysqladmin)...${NC}"
brew install mysql-client

echo -e "${GREEN}Installing PostgreSQL Clients (strategic versions for compatibility)...${NC}"
echo -e "${YELLOW}Installing PostgreSQL 14, 16, and 18 (covers PG 12-18 via backward compatibility)${NC}"
brew install postgresql@14  # Covers PG 12, 13, 14
brew install postgresql@16  # Covers PG 15, 16
brew install postgresql@18  # Covers PG 17, 18 (latest)

echo -e "${YELLOW}Note: Strategic versions installed - pg_dump 16 can dump PG 12-16 servers${NC}"
echo -e "${YELLOW}This prevents compatibility issues without installing every version${NC}"

echo -e "${GREEN}Installing MongoDB Database Tools (mongodump, mongorestore)...${NC}"
brew tap mongodb/brew
brew install mongodb-database-tools
brew install mongosh

echo -e "${GREEN}Installing generally useful tools (zip)...${NC}"
brew install zip

echo -e "${YELLOW}----------------------------------------------------------------${NC}"
echo -e "${RED}IMPORTANT ACTION REQUIRED:${NC}"
echo -e "${YELLOW}Add strategic PostgreSQL versions and MySQL to your PATH:${NC}"
echo ""
echo 'export PATH="/opt/homebrew/opt/mysql-client/bin:/opt/homebrew/opt/postgresql@18/bin:/opt/homebrew/opt/postgresql@16/bin:/opt/homebrew/opt/postgresql@14/bin:$PATH"'
echo ""
echo -e "${YELLOW}Add to ~/.zshrc permanently:${NC}"
echo 'echo '\''export PATH="/opt/homebrew/opt/mysql-client/bin:/opt/homebrew/opt/postgresql@18/bin:/opt/homebrew/opt/postgresql@16/bin:/opt/homebrew/opt/postgresql@14/bin:$PATH"'\'' >> ~/.zshrc'
echo 'source ~/.zshrc'
echo ""
echo -e "${GREEN}Version-matching uses nearest lower version (PG13 server → uses pg_dump 14, works perfectly!).${NC}"
echo -e "${YELLOW}----------------------------------------------------------------${NC}"
