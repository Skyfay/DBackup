#!/bin/bash
# Turns a plain Ubuntu 24.04 into the customer server of the dev lab: the databases installed from
# packages the way most servers DBackup backs up run them, each with the dataset of the lab, and
# an OpenSSH login without root on its own port. Run by `pnpm lab:provision <host>`, which copies
# lab/ to /opt/dbackup-lab first. Safe to run again.
#
#   LAB_USER         the login of OpenSSH and of every database (default dbackup)
#   LAB_PASSWORD     its password, required
#   LAB_SSH_PORT     the extra port of OpenSSH (default 2222)
set -euo pipefail

LAB_DIR=/opt/dbackup-lab
DATASETS="$LAB_DIR/datasets"
USER_NAME="${LAB_USER:-dbackup}"
PASSWORD="${LAB_PASSWORD:?LAB_PASSWORD is required}"
SSH_PORT="${LAB_SSH_PORT:-2222}"
export DEBIAN_FRONTEND=noninteractive

step() { echo "==> $*"; }

# ── Packages ───────────────────────────────────────────────
step "Packages"
apt-get update -qq
apt-get install -y -qq --no-install-recommends \
    postgresql-16 mysql-server redis-server sqlite3 rsync openssh-server gnupg curl ca-certificates >/dev/null

# MongoDB 5 and later need AVX. A VM with a generic CPU model has none, give it the CPU of its host.
MONGODB=yes
grep -qw avx /proc/cpuinfo || MONGODB=no
if [ "$MONGODB" = yes ]; then
    if [ ! -f /etc/apt/sources.list.d/mongodb-org-8.0.list ]; then
        curl -fsSL https://www.mongodb.org/static/pgp/server-8.0.asc | gpg --dearmor -o /usr/share/keyrings/mongodb-server-8.0.gpg
        echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg ] https://repo.mongodb.org/apt/ubuntu noble/mongodb-org/8.0 multiverse" \
            > /etc/apt/sources.list.d/mongodb-org-8.0.list
        apt-get update -qq
    fi
    apt-get install -y -qq mongodb-org >/dev/null
fi

# ── The login ──────────────────────────────────────────────
step "User $USER_NAME and OpenSSH on port $SSH_PORT"
id "$USER_NAME" >/dev/null 2>&1 || useradd --create-home --shell /bin/bash "$USER_NAME"
echo "$USER_NAME:$PASSWORD" | chpasswd
# Port 22 belongs to NetBird SSH on this network, which takes any login. The extra port reaches
# OpenSSH itself, so a wrong password fails there like on a real server.
printf '%s\n' 'Port 22' "Port $SSH_PORT" 'PasswordAuthentication yes' 'AllowTcpForwarding yes' > /etc/ssh/sshd_config.d/10-dbackup-lab.conf
systemctl daemon-reload
systemctl restart ssh.socket 2>/dev/null || systemctl restart ssh

# ── PostgreSQL ─────────────────────────────────────────────
step "PostgreSQL"
systemctl enable --now postgresql >/dev/null
sudo -u postgres psql -qtAc "SELECT 1 FROM pg_roles WHERE rolname = '$USER_NAME'" | grep -q 1 \
    || sudo -u postgres psql -qc "CREATE ROLE \"$USER_NAME\" LOGIN SUPERUSER"
sudo -u postgres psql -qc "ALTER ROLE \"$USER_NAME\" PASSWORD '$PASSWORD'"
if ! sudo -u postgres psql -qtAc "SELECT 1 FROM pg_database WHERE datname = 'inventory'" | grep -q 1; then
    sudo -u postgres psql -q -v ON_ERROR_STOP=1 -f "$DATASETS/postgres.sql"
fi

# ── MySQL ──────────────────────────────────────────────────
step "MySQL"
systemctl enable --now mysql >/dev/null
# root keeps auth_socket, as Ubuntu installs it. The lab login has a password.
mysql -e "CREATE USER IF NOT EXISTS '$USER_NAME'@'localhost' IDENTIFIED BY '$PASSWORD';
          ALTER USER '$USER_NAME'@'localhost' IDENTIFIED BY '$PASSWORD';
          GRANT ALL PRIVILEGES ON *.* TO '$USER_NAME'@'localhost' WITH GRANT OPTION;"
if [ -z "$(mysql -N -e "SHOW DATABASES LIKE 'inventory'")" ]; then
    mysql --default-character-set=utf8mb4 < "$DATASETS/mysql.sql"
fi

# ── MongoDB ────────────────────────────────────────────────
step "MongoDB"
if [ "$MONGODB" = no ]; then
    echo "    Skipped: this CPU has no AVX, which MongoDB 5 and later need. Set the CPU type of the VM to host."
else
systemctl enable --now mongod >/dev/null
for _ in $(seq 1 30); do mongosh --quiet --eval 'db.runCommand({ ping: 1 })' >/dev/null 2>&1 && break; sleep 1; done
if ! grep -q '^security:' /etc/mongod.conf; then
    # Before authorization is on, the first user comes from localhost without a login.
    mongosh --quiet admin --eval "db.createUser({ user: '$USER_NAME', pwd: '$PASSWORD', roles: ['root'] })"
    printf '\nsecurity:\n  authorization: enabled\n' >> /etc/mongod.conf
    systemctl restart mongod
    for _ in $(seq 1 30); do mongosh --quiet --eval 'db.runCommand({ ping: 1 })' >/dev/null 2>&1 && break; sleep 1; done
fi
MONGO="mongosh --quiet -u $USER_NAME -p $PASSWORD --authenticationDatabase admin"
if [ -z "$($MONGO --eval "if (db.getMongo().getDBNames().indexOf('inventory') >= 0) print('yes')")" ]; then
    $MONGO < "$DATASETS/mongodb.js" >/dev/null
fi
fi

# ── Redis ──────────────────────────────────────────────────
step "Redis"
sed -i -E "s/^#? *requirepass .*/requirepass $PASSWORD/" /etc/redis/redis.conf
grep -q "^requirepass $PASSWORD" /etc/redis/redis.conf || echo "requirepass $PASSWORD" >> /etc/redis/redis.conf
systemctl enable redis-server >/dev/null
systemctl restart redis-server
if [ "$(redis-cli -a "$PASSWORD" --no-auth-warning EXISTS lab:dataset)" != "1" ]; then
    redis-cli -a "$PASSWORD" --no-auth-warning < "$DATASETS/redis.txt" >/dev/null
fi

# ── SQLite ─────────────────────────────────────────────────
step "SQLite"
HOME_DIR=$(getent passwd "$USER_NAME" | cut -d: -f6)
if [ ! -f "$HOME_DIR/shop.db" ]; then
    sqlite3 "$HOME_DIR/shop.db" < "$DATASETS/sqlite.sql"
    chown "$USER_NAME:$USER_NAME" "$HOME_DIR/shop.db"
fi

MONGODB_VERSION=none
[ "$MONGODB" = yes ] && MONGODB_VERSION=$(mongod --version | head -1 | awk '{print $3}')
step "Done: PostgreSQL $(sudo -u postgres psql -qtAc 'SHOW server_version' | cut -d' ' -f1), MySQL $(mysql -N -e 'SELECT VERSION()'), MongoDB $MONGODB_VERSION, Redis $(redis-server --version | awk '{print $3}' | cut -d= -f2)"
