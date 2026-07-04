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

echo -e "${GREEN}Installing LZ4 and ZSTD (required for native PostgreSQL compression support)...${NC}"
brew install lz4 zstd

echo -e "${GREEN}Installing PostgreSQL Clients (strategic versions for compatibility)...${NC}"
echo -e "${YELLOW}Installing PostgreSQL 14, 16, and 18 (covers PG 12-18 via backward compatibility)${NC}"
# NOTE: Always install full postgresql@XX packages, NOT libpq.
# libpq is a minimal client library compiled WITHOUT LZ4/ZSTD support.
# The full postgresql@XX packages include a pg_dump binary with LZ4/ZSTD enabled.
brew install postgresql@14  # Covers PG 12, 13, 14
brew install postgresql@16  # Covers PG 15, 16 - includes LZ4 support
brew install postgresql@18  # Covers PG 17, 18 (latest) - includes LZ4 + ZSTD support

echo -e "${YELLOW}Note: Strategic versions installed - pg_dump 16 can dump PG 12-16 servers${NC}"
echo -e "${YELLOW}This prevents compatibility issues without installing every version${NC}"

echo -e "${GREEN}Installing MongoDB Database Tools (mongodump, mongorestore)...${NC}"
brew tap mongodb/brew
brew install mongodb-database-tools
brew install mongosh

echo -e "${GREEN}Installing Redis CLI (redis-cli)...${NC}"
brew install redis

echo -e "${GREEN}Installing Firebird client tools (gbak, isql)...${NC}"
echo -e "${YELLOW}Homebrew has no Firebird formula, so this downloads the official client${NC}"
echo -e "${YELLOW}binaries directly instead of running the full server .pkg installer${NC}"
echo -e "${YELLOW}(which requires sudo and sets up a local Firebird server/daemon we don't need).${NC}"

FIREBIRD_TAG="5.0.3"
FIREBIRD_ASSET_VERSION="5.0.3.1683-0"
case "$(uname -m)" in
    arm64) FB_MAC_ARCH="arm64" ;;
    x86_64) FB_MAC_ARCH="x64" ;;
    *) FB_MAC_ARCH="" ;;
esac

if [ -z "$FB_MAC_ARCH" ]; then
    echo -e "${RED}Unsupported architecture for Firebird client install: $(uname -m). Skipping.${NC}"
else
    FB_PREFIX="$(brew --prefix)/firebird-client"
    if [ -x "$FB_PREFIX/bin/gbak" ]; then
        echo -e "${YELLOW}Firebird client tools already present at $FB_PREFIX - skipping.${NC}"
    else
        FB_PKG_URL="https://github.com/FirebirdSQL/firebird/releases/download/v${FIREBIRD_TAG}/Firebird-${FIREBIRD_ASSET_VERSION}-macos-${FB_MAC_ARCH}.pkg"
        FB_TMP_DIR=$(mktemp -d)
        echo -e "${GREEN}Downloading $FB_PKG_URL ...${NC}"
        if curl -fsSL "$FB_PKG_URL" -o "$FB_TMP_DIR/firebird.pkg"; then
            pkgutil --expand "$FB_TMP_DIR/firebird.pkg" "$FB_TMP_DIR/expanded"
            mkdir -p "$FB_TMP_DIR/payload"
            (cd "$FB_TMP_DIR/payload" && gunzip -dc "$FB_TMP_DIR/expanded/Firebird.pkg/Payload" | cpio -id) &> /dev/null

            mkdir -p "$FB_PREFIX/bin" "$FB_PREFIX/lib"
            cp "$FB_TMP_DIR/payload/Versions/A/Resources/bin/gbak" "$FB_PREFIX/bin/"
            cp "$FB_TMP_DIR/payload/Versions/A/Resources/bin/isql" "$FB_PREFIX/bin/"
            # gbak/isql use a relative rpath (@loader_path/..), so keeping this
            # bin/ + lib/ layout side by side is what makes them find these dylibs.
            cp "$FB_TMP_DIR/payload/Versions/A/Resources/lib/libfbclient.dylib" \
               "$FB_TMP_DIR/payload/Versions/A/Resources/lib/libtommath.dylib" \
               "$FB_TMP_DIR/payload/Versions/A/Resources/lib/libtomcrypt.dylib" \
               "$FB_PREFIX/lib/"
            # firebird.msg provides human-readable status/error text; isql/gbak look
            # for it at "../firebird.msg" relative to bin/, i.e. directly in $FB_PREFIX.
            cp "$FB_TMP_DIR/payload/Versions/A/Resources/firebird.msg" "$FB_PREFIX/"

            echo -e "${GREEN}Firebird client tools installed to $FB_PREFIX/bin${NC}"
        else
            echo -e "${RED}Failed to download Firebird client package - skipping. Install manually from https://github.com/FirebirdSQL/firebird/releases if needed.${NC}"
        fi
        rm -rf "$FB_TMP_DIR"
    fi
fi

echo -e "${GREEN}Installing SMB Client (smbclient for Samba storage adapter)...${NC}"
brew install samba

echo -e "${GREEN}Installing rsync (for Rsync storage adapter)...${NC}"
brew install rsync

echo -e "${GREEN}Installing sshpass (for Rsync password authentication)...${NC}"
brew install hudochenkov/sshpass/sshpass || echo -e "${YELLOW}sshpass install failed - password auth for rsync will not work. Use SSH keys instead.${NC}"

echo -e "${GREEN}Installing generally useful tools (zip)...${NC}"
brew install zip

echo -e "${YELLOW}----------------------------------------------------------------${NC}"
echo -e "${RED}IMPORTANT ACTION REQUIRED:${NC}"
echo -e "${YELLOW}Add strategic PostgreSQL versions and MySQL to your PATH:${NC}"
echo -e "${RED}IMPORTANT: postgresql@XX must come BEFORE /opt/homebrew/bin in PATH.${NC}"
echo -e "${YELLOW}The 'libpq' package installs a pg_dump WITHOUT LZ4/ZSTD support into${NC}"
echo -e "${YELLOW}/opt/homebrew/opt/libpq/bin - if that comes first, native compression fails.${NC}"
echo ""
echo 'export PATH="/opt/homebrew/opt/mysql-client/bin:/opt/homebrew/opt/postgresql@18/bin:/opt/homebrew/opt/postgresql@16/bin:/opt/homebrew/opt/postgresql@14/bin:/opt/homebrew/firebird-client/bin:$PATH"'
echo ""
echo -e "${YELLOW}Add to ~/.zshrc permanently:${NC}"
echo 'echo '\''export PATH="/opt/homebrew/opt/mysql-client/bin:/opt/homebrew/opt/postgresql@18/bin:/opt/homebrew/opt/postgresql@16/bin:/opt/homebrew/opt/postgresql@14/bin:/opt/homebrew/firebird-client/bin:$PATH"'\'' >> ~/.zshrc'
echo 'source ~/.zshrc'
echo ""
echo -e "${GREEN}Version-matching uses nearest lower version (PG13 server uses pg_dump 14, works perfectly!).${NC}"
echo -e "${YELLOW}----------------------------------------------------------------${NC}"
