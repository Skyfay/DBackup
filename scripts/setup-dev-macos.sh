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

# Node comes from fnm in the version of .node-version, the one CI and the Docker image use.
# A plain `brew install node` would follow the newest release instead.
NODE_VERSION="$(tr -d '[:space:]' < "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.node-version")"
echo -e "${GREEN}Installing fnm and Node ${NODE_VERSION}...${NC}"
brew install fnm
eval "$(fnm env --shell bash)"
fnm install "$NODE_VERSION"
fnm use "$NODE_VERSION"
# The first Node of a fresh fnm becomes the default for terminals outside the project.
fnm list | grep -q "default" || fnm default "$NODE_VERSION"

echo -e "${GREEN}Installing pnpm 10...${NC}"
npm install -g pnpm@10

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

echo -e "${GREEN}Installing SqlPackage (BACPAC export/import for the Azure SQL Database adapter)...${NC}"
echo -e "${YELLOW}Microsoft's standalone macOS download is x64-only. The dotnet tool is portable IL${NC}"
echo -e "${YELLOW}and runs natively on Apple Silicon, which is the route the container image takes too.${NC}"
if ! command -v dotnet &> /dev/null; then
    brew install dotnet
fi
if command -v dotnet &> /dev/null; then
    SQLPKG_PREFIX="$(brew --prefix)"
    SQLPKG_SHARE="$SQLPKG_PREFIX/share/sqlpackage"
    SQLPKG_TMP="$(mktemp -d)"

    # Installed into a temp path and then relocated, rather than left in
    # ~/.dotnet/tools. That directory is on nobody's PATH by default, and a dev
    # server started from an editor inherits its environment at launch, so the
    # adapter reported "sqlpackage was not found" even after a correct install.
    # $(brew --prefix)/bin is already on PATH for anyone with Homebrew.
    if dotnet tool install --tool-path "$SQLPKG_TMP" microsoft.sqlpackage > /dev/null 2>&1; then
        # The package ships several target frameworks side by side. Picking the first
        # one `find` returns lands on net8.0, whose launcher then demands a .NET 8
        # runtime that a Homebrew install of dotnet 10 does not have. Match the
        # installed runtime instead, and fall back to the newest build on offer.
        SQLPKG_MAJOR="$(dotnet --list-runtimes | awk '/Microsoft.NETCore.App/ {print $2}' | cut -d. -f1 | sort -n | tail -1)"
        SQLPKG_PAYLOAD="$(find "$SQLPKG_TMP/.store" -type d -path "*/tools/net${SQLPKG_MAJOR}.0/any" | head -1)"
        if [ -z "$SQLPKG_PAYLOAD" ]; then
            SQLPKG_PAYLOAD="$(find "$SQLPKG_TMP/.store" -type d -path '*/tools/net*/any' | sort -V | tail -1)"
        fi
        if [ -n "$SQLPKG_PAYLOAD" ]; then
            rm -rf "$SQLPKG_SHARE"
            mkdir -p "$SQLPKG_SHARE"
            cp -a "$SQLPKG_PAYLOAD"/. "$SQLPKG_SHARE/"

            # A wrapper rather than the apphost shim. The shim probes the default
            # /usr/local/share/dotnet for a runtime that Homebrew keeps under its own
            # prefix, and fails with "Download the .NET runtime" - which reads as a
            # missing install rather than a missing DOTNET_ROOT. Naming the runtime
            # outright removes the variable from the picture entirely.
            printf '#!/bin/sh\nexec "%s" "%s/sqlpackage.dll" "$@"\n' \
                "$(command -v dotnet)" "$SQLPKG_SHARE" > "$SQLPKG_PREFIX/bin/sqlpackage"
            chmod +x "$SQLPKG_PREFIX/bin/sqlpackage"

            echo -e "${GREEN}SqlPackage installed to $SQLPKG_PREFIX/bin/sqlpackage ($("$SQLPKG_PREFIX/bin/sqlpackage" /version 2>/dev/null | tail -1))${NC}"
        else
            echo -e "${RED}Could not locate the SqlPackage payload - skipping.${NC}"
        fi
    else
        echo -e "${RED}SqlPackage install failed - the Azure SQL Database adapter will not work locally.${NC}"
    fi
    rm -rf "$SQLPKG_TMP"
else
    echo -e "${RED}dotnet is unavailable - skipping SqlPackage. The Azure SQL Database adapter will not work locally.${NC}"
fi

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
echo -e "${GREEN}SqlPackage needs no PATH entry - it was installed into $(brew --prefix)/bin, which is already there.${NC}"
echo ""
echo -e "${YELLOW}Add to ~/.zshrc permanently. The first line lets fnm switch to the Node of .node-version:${NC}"
echo 'echo '\''eval "$(fnm env --use-on-cd)"'\'' >> ~/.zshrc'
echo 'echo '\''export PATH="/opt/homebrew/opt/mysql-client/bin:/opt/homebrew/opt/postgresql@18/bin:/opt/homebrew/opt/postgresql@16/bin:/opt/homebrew/opt/postgresql@14/bin:/opt/homebrew/firebird-client/bin:$PATH"'\'' >> ~/.zshrc'
echo 'source ~/.zshrc'
echo ""
echo -e "${GREEN}Version-matching uses nearest lower version (PG13 server uses pg_dump 14, works perfectly!).${NC}"
echo -e "${YELLOW}----------------------------------------------------------------${NC}"
