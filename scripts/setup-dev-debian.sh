#!/usr/bin/env bash
# -------------------------------------------------------------------
# DBackup — Install all database client binaries on Debian/Ubuntu
#
# Supported databases:
#   MySQL / MariaDB  → mysqldump, mysql
#   PostgreSQL 14-17 → pg_dump, pg_restore (versioned, like Docker image)
#   MongoDB          → mongodump, mongorestore, mongosh
#   SQLite           → sqlite3
#   Redis            → redis-cli
#   Firebird         → gbak, isql (5.x, like Docker image)
#   MSSQL            → (no binary needed, uses Node.js mssql driver)
#
# Usage:  sudo ./scripts/setup-dev-debian.sh
# -------------------------------------------------------------------
set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# Require root
[[ $EUID -eq 0 ]] || error "This script must be run as root (sudo)."

# Detect architecture
ARCH=$(dpkg --print-architecture)
info "Detected architecture: $ARCH"

# -------------------------------------------------------------------
# 1. Common prerequisites
# -------------------------------------------------------------------
info "Installing common prerequisites..."
apt-get update -qq
apt-get install -y -qq curl gnupg lsb-release ca-certificates apt-transport-https wget > /dev/null
CODENAME=$(lsb_release -cs)
info "Detected Debian/Ubuntu codename: $CODENAME"

# -------------------------------------------------------------------
# 1b. Node.js in the version of .node-version, and pnpm 10
#     NodeSource installs it system wide, since this script runs as root.
# -------------------------------------------------------------------
NODE_VERSION="$(tr -d '[:space:]' < "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.node-version")"
if command -v node &>/dev/null && [[ "$(node -v)" == "v${NODE_VERSION}."* ]]; then
    info "Node.js $(node -v) is already installed."
else
    info "Installing Node.js ${NODE_VERSION} from NodeSource..."
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | bash - > /dev/null
    apt-get install -y -qq nodejs > /dev/null
fi
info "Installing pnpm 10..."
npm install -g --loglevel=error pnpm@10 > /dev/null

# -------------------------------------------------------------------
# 2. MySQL / MariaDB client (mysqldump, mysql)
# -------------------------------------------------------------------
info "Installing MySQL client tools..."
apt-get install -y -qq default-mysql-client > /dev/null
mysql --version && info "MySQL client installed ✓" || warn "MySQL client check failed"

# -------------------------------------------------------------------
# 3. PostgreSQL clients — versioned (14, 16, 17, 18)
#    Mirrors the Docker image strategy with /opt/pgXX/bin symlinks
# -------------------------------------------------------------------
info "Adding PostgreSQL APT repository..."
curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor --yes -o /usr/share/keyrings/postgresql-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/postgresql-archive-keyring.gpg] https://apt.postgresql.org/pub/repos/apt ${CODENAME}-pgdg main" > /etc/apt/sources.list.d/pgdg.list
apt-get update -qq

PG_VERSIONS=(14 16 17 18)
for ver in "${PG_VERSIONS[@]}"; do
    info "Installing PostgreSQL $ver client..."
    apt-get install -y -qq "postgresql-client-${ver}" > /dev/null 2>&1 || {
        warn "PostgreSQL $ver client not available for $CODENAME — skipping"
        continue
    }

    # Create /opt/pgXX/bin/ symlinks (same layout as Docker image)
    mkdir -p "/opt/pg${ver}/bin"
    for bin in pg_dump pg_restore psql; do
        ln -sf "/usr/lib/postgresql/${ver}/bin/${bin}" "/opt/pg${ver}/bin/${bin}"
    done

    "/opt/pg${ver}/bin/pg_dump" --version && info "PostgreSQL $ver client installed ✓" || warn "PostgreSQL $ver validation failed"
done

# -------------------------------------------------------------------
# 4. MongoDB Database Tools (mongodump, mongorestore)
# -------------------------------------------------------------------
info "Installing MongoDB Database Tools..."
if [[ "$ARCH" == "amd64" || "$ARCH" == "arm64" ]]; then
    MONGO_INSTALLED=false

    # Detect distro (debian vs ubuntu) and map to a supported codename
    DISTRO_ID=$(. /etc/os-release && echo "$ID")
    if [[ "$DISTRO_ID" == "ubuntu" ]]; then
        # Ubuntu: use codename directly, fallback to noble
        MONGO_CODENAME="$CODENAME"
        MONGO_REPO_BASE="https://repo.mongodb.org/apt/ubuntu"
        # MongoDB publishes its Ubuntu packages under multiverse. With main, apt finds nothing.
        MONGO_COMPONENT="multiverse"
    else
        # Debian: MongoDB only supports specific versions — map to nearest supported
        case "$CODENAME" in
            bookworm) MONGO_CODENAME="bookworm" ;;
            trixie|sid|*) MONGO_CODENAME="bookworm" ;; # Fallback to latest supported
        esac
        MONGO_REPO_BASE="https://repo.mongodb.org/apt/debian"
        MONGO_COMPONENT="main"
    fi

    info "Using MongoDB repo for $DISTRO_ID/$MONGO_CODENAME..."
    curl -fsSL https://www.mongodb.org/static/pgp/server-8.0.asc | gpg --dearmor --yes -o /usr/share/keyrings/mongodb-server-8.0.gpg
    echo "deb [signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg] ${MONGO_REPO_BASE} ${MONGO_CODENAME}/mongodb-org/8.0 ${MONGO_COMPONENT}" > /etc/apt/sources.list.d/mongodb-org-8.0.list
    apt-get update -qq
    apt-get install -y -qq mongodb-database-tools > /dev/null 2>&1 && MONGO_INSTALLED=true

    # Fallback: install via mongodb-org meta-package (includes tools)
    if [[ "$MONGO_INSTALLED" == false ]]; then
        warn "mongodb-database-tools standalone not available — trying mongodb-org package"
        apt-get install -y -qq mongodb-org-tools > /dev/null 2>&1 && MONGO_INSTALLED=true
    fi

    if [[ "$MONGO_INSTALLED" == true ]]; then
        mongodump --version 2>/dev/null && info "MongoDB Database Tools installed ✓" || warn "mongodump not found in PATH"
    else
        warn "MongoDB tools could not be installed via APT for $DISTRO_ID/$MONGO_CODENAME"
        warn "Install manually: https://www.mongodb.com/try/download/database-tools"
    fi

    # Install mongosh (MongoDB Shell) — required for SSH connection tests and database listing
    info "Installing MongoDB Shell (mongosh)..."
    apt-get install -y -qq mongodb-mongosh > /dev/null 2>&1 && {
        mongosh --version 2>/dev/null && info "mongosh installed ✓"
    } || {
        warn "mongosh not available via APT — trying direct install"
        MONGOSH_URL="https://downloads.mongodb.com/compass/mongodb-mongosh_2.5.0_${ARCH}.deb"
        wget -q "$MONGOSH_URL" -O /tmp/mongosh.deb 2>/dev/null && dpkg -i /tmp/mongosh.deb > /dev/null 2>&1 && rm -f /tmp/mongosh.deb && {
            mongosh --version 2>/dev/null && info "mongosh installed ✓"
        } || warn "mongosh installation failed — install manually: https://www.mongodb.com/try/download/shell"
    }
else
    warn "MongoDB Database Tools: unsupported architecture $ARCH — skipping"
fi

# -------------------------------------------------------------------
# 5. SQLite3
# -------------------------------------------------------------------
info "Installing SQLite3..."
apt-get install -y -qq sqlite3 > /dev/null
sqlite3 --version && info "SQLite3 installed ✓" || warn "SQLite3 check failed"

# -------------------------------------------------------------------
# 6. Redis CLI (redis-cli)
# -------------------------------------------------------------------
info "Installing Redis tools..."
apt-get install -y -qq redis-tools > /dev/null
redis-cli --version && info "Redis CLI installed ✓" || warn "Redis CLI check failed"

# -------------------------------------------------------------------
# 7. Additional tools used by DBackup (SSH, rsync, smbclient, lz4, zstd)
# -------------------------------------------------------------------
info "Installing additional tools (SSH, rsync, smbclient, lz4, zstd)..."
apt-get install -y -qq openssh-client sshpass rsync smbclient openssl zip lz4 zstd > /dev/null

# -------------------------------------------------------------------
# 8. Firebird 5.x client tools (gbak, isql)
#
# The distro repos only carry an older client, so this takes the official
# release tarball, the same one and the same /opt/firebird layout as the
# Dockerfile. Bump both versions there and here together.
# -------------------------------------------------------------------
info "Installing Firebird client tools (gbak, isql)..."
FIREBIRD_TAG="5.0.3"
FIREBIRD_ASSET_VERSION="5.0.3.1683-0"
case "$ARCH" in
    amd64) FB_ARCH="x64" ;;
    arm64) FB_ARCH="arm64" ;;
    *) FB_ARCH="" ;;
esac

# gbak -z prints its version and then exits 1, which pipefail would turn into a failure
FB_PRESENT="$(/opt/firebird/bin/gbak -z 2>&1 || true)"
if [[ -z "$FB_ARCH" ]]; then
    warn "Firebird client tools: unsupported architecture $ARCH - skipping"
elif [[ "$FB_PRESENT" == *"V${FIREBIRD_ASSET_VERSION%-*}"* ]]; then
    info "Firebird client tools ${FIREBIRD_TAG} are already installed."
else
    # gbak and isql link against libtommath and zlib, which the tarball does not ship
    apt-get install -y -qq libtommath1 zlib1g > /dev/null
    FB_TMP_DIR="$(mktemp -d)"
    FB_URL="https://github.com/FirebirdSQL/firebird/releases/download/v${FIREBIRD_TAG}/Firebird-${FIREBIRD_ASSET_VERSION}-linux-${FB_ARCH}.tar.gz"
    if curl -fsSL "$FB_URL" -o "$FB_TMP_DIR/firebird.tar.gz"; then
        # The release tarball holds an installer and a nested buildroot.tar.gz,
        # and the binaries sit in that inner archive under ./opt/firebird.
        tar -xzf "$FB_TMP_DIR/firebird.tar.gz" -C "$FB_TMP_DIR" --strip-components=1
        tar -xzf "$FB_TMP_DIR/buildroot.tar.gz" -C "$FB_TMP_DIR"
        mkdir -p /opt/firebird/bin /opt/firebird/lib
        cp "$FB_TMP_DIR/opt/firebird/bin/gbak" "$FB_TMP_DIR/opt/firebird/bin/isql" /opt/firebird/bin/
        cp -a "$FB_TMP_DIR/opt/firebird/lib/." /opt/firebird/lib/
        cp "$FB_TMP_DIR/opt/firebird/firebird.msg" /opt/firebird/
        ln -sf /opt/firebird/bin/gbak /usr/local/bin/gbak
        ln -sf /opt/firebird/bin/isql /usr/local/bin/isql
        echo "/opt/firebird/lib" > /etc/ld.so.conf.d/firebird.conf
        ldconfig
        FB_PRESENT="$(/opt/firebird/bin/gbak -z 2>&1 || true)"
        [[ "$FB_PRESENT" == *"Firebird"* ]] && info "Firebird client tools installed ✓" || warn "Firebird client check failed"
    else
        warn "Failed to download the Firebird client - skipping. Install manually from https://github.com/FirebirdSQL/firebird/releases if needed."
    fi
    rm -rf "$FB_TMP_DIR"
fi

# -------------------------------------------------------------------
# SqlPackage - BACPAC export/import for the Azure SQL Database adapter
#
# Installed as a dotnet tool rather than from Microsoft's standalone zip, which
# is published for linux-x64 only. The tool is portable IL and works on arm64,
# which is the same route the container image takes.
# -------------------------------------------------------------------
info "Installing SqlPackage (Azure SQL Database adapter)..."
if ! command -v dotnet &>/dev/null; then
    apt-get install -y -qq libicu-dev &>/dev/null || apt-get install -y -qq libicu72 &>/dev/null || true
    curl -fsSL https://dot.net/v1/dotnet-install.sh -o /tmp/dotnet-install.sh
    bash /tmp/dotnet-install.sh --channel 10.0 --install-dir /usr/share/dotnet --no-path
    ln -sf /usr/share/dotnet/dotnet /usr/local/bin/dotnet
    rm -f /tmp/dotnet-install.sh
fi
if command -v dotnet &>/dev/null; then
    SQLPKG_TMP="$(mktemp -d)"
    if dotnet tool install --tool-path "$SQLPKG_TMP" microsoft.sqlpackage &>/dev/null; then
        # The package ships several target frameworks side by side, and the first one
        # `find` returns is net8.0, whose launcher demands a .NET 8 runtime this script
        # does not install. Match the runtime that is actually present.
        SQLPKG_MAJOR="$(dotnet --list-runtimes | awk '/Microsoft.NETCore.App/ {print $2}' | cut -d. -f1 | sort -n | tail -1)"
        SQLPKG_PAYLOAD="$(find "$SQLPKG_TMP/.store" -type d -path "*/tools/net${SQLPKG_MAJOR}.0/any" | head -1)"
        [ -z "$SQLPKG_PAYLOAD" ] && SQLPKG_PAYLOAD="$(find "$SQLPKG_TMP/.store" -type d -path '*/tools/net*/any' | sort -V | tail -1)"

        if [ -n "$SQLPKG_PAYLOAD" ]; then
            rm -rf /usr/local/share/sqlpackage
            mkdir -p /usr/local/share/sqlpackage
            cp -a "$SQLPKG_PAYLOAD"/. /usr/local/share/sqlpackage/

            # A wrapper naming the runtime outright, the same shape the Dockerfile and
            # the macOS script use. The apphost shim would rely on the default runtime
            # probe paths, which is one more thing to differ between machines.
            printf '#!/bin/sh\nexec "%s" /usr/local/share/sqlpackage/sqlpackage.dll "$@"\n' \
                "$(command -v dotnet)" > /usr/local/bin/sqlpackage
            chmod +x /usr/local/bin/sqlpackage
        else
            echo -e "  ${RED}Could not locate the SqlPackage payload - skipping.${NC}"
        fi
    else
        echo -e "  ${RED}SqlPackage install failed - the Azure SQL Database adapter will not work locally.${NC}"
    fi
    rm -rf "$SQLPKG_TMP"
fi

# -------------------------------------------------------------------
# Summary
# -------------------------------------------------------------------
echo ""
info "========================================="
info "  DBackup Dev Dependencies — Summary"
info "========================================="
echo ""
for cmd in node pnpm mysql mysqldump mongodump mongorestore mongosh sqlite3 redis-cli pg_dump psql gbak isql rsync smbclient sshpass lz4 zstd sqlpackage; do
    if command -v "$cmd" &>/dev/null; then
        echo -e "  ${GREEN}✓${NC}  $cmd  ($(command -v "$cmd"))"
    else
        echo -e "  ${RED}✗${NC}  $cmd  (not found)"
    fi
done
echo ""
for ver in "${PG_VERSIONS[@]}"; do
    if [[ -x "/opt/pg${ver}/bin/pg_dump" ]]; then
        echo -e "  ${GREEN}✓${NC}  /opt/pg${ver}/bin/pg_dump  ($("/opt/pg${ver}/bin/pg_dump" --version 2>/dev/null | head -1))"
    else
        echo -e "  ${RED}✗${NC}  /opt/pg${ver}/bin/pg_dump  (not installed)"
    fi
done
echo ""
info "Done. MSSQL uses the Node.js mssql driver - no binary needed."
info "Azure SQL Database additionally needs sqlpackage, listed above."
