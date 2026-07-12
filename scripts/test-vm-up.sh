#!/bin/bash
#
# Test VM for SSH mode testing
#
# Creates (or resumes) a Multipass VM, installs Docker inside it, and starts
# ONE container per database family from docker-compose.test.yml there (not
# the full 16-container matrix - that's for the stress/CI test suite, not for
# exercising the SSH code path, and would need way more RAM than a dev laptop
# wants to spare). The VM is reachable via real SSH, so it doubles as:
#   - a remote host for testing DB adapters' "ssh" connection mode
#   - an SSH-reachable target for the SFTP/Rsync storage destinations
#
# Usage:
#   pnpm run test:vm:up
#   pnpm run test:vm:seed   # after this, seeds SSH-mode DB sources + SFTP/Rsync destinations
#
# Note on manual SSH: if you get "Too many authentication failures", your
# local ssh-agent is offering other keys before this one and the VM's sshd
# gives up after its MaxAuthTries limit. Force this key specifically:
#   ssh -o IdentitiesOnly=yes -i ~/.dbackup-test-vm/id_ed25519 ubuntu@<vm-ip>
#
# Environment:
#   VM_NAME=dbackup-test-vm
#   VM_CPUS=2
#   VM_MEMORY=4G
#   VM_DISK=40G
#   VM_RELEASE=24.04
#   VM_SERVICES="mysql-9 mariadb-11 postgres-12 mongo-8 redis-8 valkey-8 firebird-50"
#     Service names must match docker-compose.test.yml. All of these run
#     natively on arm64 (no QEMU emulation) on Apple Silicon. MSSQL is
#     intentionally left out for now - it's by far the heaviest single
#     container and always needs amd64 emulation (Microsoft ships no arm64
#     SQL Server image). Add "mssql-2022" back to VM_SERVICES if you need it.

set -e

VM_NAME="${VM_NAME:-dbackup-test-vm}"
VM_CPUS="${VM_CPUS:-2}"
VM_MEMORY="${VM_MEMORY:-4G}"
VM_DISK="${VM_DISK:-40G}"
VM_RELEASE="${VM_RELEASE:-24.04}"
VM_SERVICES="${VM_SERVICES:-mysql-9 mariadb-11 postgres-12 mongo-8 redis-8 valkey-8 firebird-50}"

KEY_DIR="$HOME/.dbackup-test-vm"
KEY_PATH="$KEY_DIR/id_ed25519"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$REPO_ROOT/docker-compose.test.yml"
MONGO_INIT_FILE="$REPO_ROOT/scripts/mongo-init.js"

if ! command -v multipass &> /dev/null; then
    echo "❌ Multipass is not installed. Install it from https://multipass.run first."
    exit 1
fi

if [ ! -f "$COMPOSE_FILE" ]; then
    echo "❌ Could not find docker-compose.test.yml at $COMPOSE_FILE"
    exit 1
fi

# --- Dedicated SSH keypair (kept outside the repo, never reuse your personal key) ---
mkdir -p "$KEY_DIR"
if [ ! -f "$KEY_PATH" ]; then
    echo "🔑 Generating a dedicated SSH keypair for the test VM..."
    ssh-keygen -t ed25519 -N "" -C "dbackup-test-vm" -f "$KEY_PATH" -q
fi
PUBLIC_KEY=$(cat "$KEY_PATH.pub")

# --- Cloud-init: Docker + qemu binfmt (several test images are linux/amd64-only,
# needed for Apple Silicon hosts where the VM itself runs arm64) ---
CLOUD_INIT_FILE=$(mktemp)
trap 'rm -f "$CLOUD_INIT_FILE"' EXIT

cat > "$CLOUD_INIT_FILE" <<EOF
#cloud-config
ssh_authorized_keys:
  - $PUBLIC_KEY
package_update: true
packages:
  - docker.io
  - docker-compose-v2
  - qemu-user-static
  - binfmt-support
runcmd:
  - systemctl enable --now docker
  - usermod -aG docker ubuntu
  # DB client tools for testing SSH-mode dumps (mysqldump/pg_dump/redis-cli/mongodump
  # run directly on the VM, not inside the containers). Best-effort: don't fail
  # the whole provisioning if one is unavailable for this architecture.
  - apt-get install -y --no-install-recommends mariadb-client || echo "mariadb-client unavailable, skipping"
  - apt-get install -y --no-install-recommends postgresql-client || echo "postgresql-client unavailable, skipping"
  - apt-get install -y --no-install-recommends redis-tools || echo "redis-tools unavailable, skipping"
  # mongodump isn't in Ubuntu's default repos - add MongoDB's official apt repo first.
  - curl -fsSL https://pgp.mongodb.com/server-8.0.asc | gpg -o /usr/share/keyrings/mongodb-server-8.0.gpg --dearmor
  - echo "deb [ arch=arm64,amd64 signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg ] https://repo.mongodb.org/apt/ubuntu noble/mongodb-org/8.0 multiverse" > /etc/apt/sources.list.d/mongodb-org-8.0.list
  - apt-get update -qq || true
  - apt-get install -y --no-install-recommends mongodb-database-tools || echo "mongodb-database-tools unavailable, skipping"
EOF

# --- Launch or resume the VM ---
if multipass info "$VM_NAME" &> /dev/null; then
    STATE=$(multipass info "$VM_NAME" | awk -F': *' '/^State/{print $2}')
    if [ "$STATE" = "Running" ]; then
        echo "✓ VM '$VM_NAME' is already running."
    else
        echo "▶️  Starting existing VM '$VM_NAME'..."
        multipass start "$VM_NAME"
    fi
else
    echo "🚀 Launching new VM '$VM_NAME' ($VM_CPUS CPUs, $VM_MEMORY RAM, $VM_DISK disk)..."
    multipass launch "$VM_RELEASE" \
        --name "$VM_NAME" \
        --cpus "$VM_CPUS" \
        --memory "$VM_MEMORY" \
        --disk "$VM_DISK" \
        --cloud-init "$CLOUD_INIT_FILE"
fi

echo "⏳ Waiting for cloud-init to finish (installing Docker, this can take a minute)..."
multipass exec "$VM_NAME" -- cloud-init status --wait

# --- Copy the test compose file into the VM and start the containers ---
echo "📦 Copying docker-compose.test.yml into the VM..."
multipass exec "$VM_NAME" -- mkdir -p scripts
multipass transfer "$COMPOSE_FILE" "$VM_NAME:docker-compose.test.yml"
if [ -f "$MONGO_INIT_FILE" ]; then
    multipass transfer "$MONGO_INIT_FILE" "$VM_NAME:scripts/mongo-init.js"
fi

echo "🐳 Starting test containers inside the VM ($VM_SERVICES)..."
read -ra VM_SERVICES_ARR <<< "$VM_SERVICES"
multipass exec "$VM_NAME" -- sudo docker compose -f docker-compose.test.yml up -d "${VM_SERVICES_ARR[@]}"

VM_IP=$(multipass info "$VM_NAME" | awk -F': *' '/^IPv4/{print $2; exit}')

echo ""
echo "✅ VM ready."
echo "   Name:       $VM_NAME"
echo "   IP:         $VM_IP"
echo "   SSH:        ssh -o IdentitiesOnly=yes -i $KEY_PATH ubuntu@$VM_IP"
echo ""
echo "Next step: pnpm run test:vm:seed"
echo "  Seeds SSH-mode DB sources (MySQL/MariaDB/PostgreSQL/MongoDB/Redis/Valkey/Firebird)"
echo "  plus SFTP/Rsync destinations, all pointing at this VM."
