#!/bin/bash
# Starts the databases of the customer server without systemd, gives the login of the lab access
# to each and loads the datasets, then runs OpenSSH in the foreground. Like lab/provision/
# ubuntu-native.sh does on a real Ubuntu, safe to run again.
#
#   LAB_USER       the login of OpenSSH and of every database (default dbackup)
#   LAB_PASSWORD   its password (default customer-password)
set -euo pipefail

USER_NAME="${LAB_USER:-dbackup}"
PASSWORD="${LAB_PASSWORD:-customer-password}"
DATASETS=/opt/dbackup-lab/datasets
rm -f /run/customer-ready

id "$USER_NAME" >/dev/null 2>&1 || useradd --create-home --shell /bin/bash "$USER_NAME"
echo "$USER_NAME:$PASSWORD" | chpasswd
ssh-keygen -A >/dev/null
mkdir -p /run/sshd
printf '%s\n' 'PasswordAuthentication yes' 'AllowTcpForwarding yes' > /etc/ssh/sshd_config.d/10-dbackup-lab.conf

wait_for() {
    for _ in $(seq 1 60); do "$@" >/dev/null 2>&1 && return 0; sleep 1; done
    echo "$1 did not come up" >&2
    return 1
}

# ── PostgreSQL ─────────────────────────────────────────────
service postgresql start >/dev/null
wait_for runuser -u postgres -- psql -qtAc "SELECT 1"
runuser -u postgres -- psql -qtAc "SELECT 1 FROM pg_roles WHERE rolname = '$USER_NAME'" | grep -q 1 \
    || runuser -u postgres -- psql -qc "CREATE ROLE \"$USER_NAME\" LOGIN SUPERUSER"
runuser -u postgres -- psql -qc "ALTER ROLE \"$USER_NAME\" PASSWORD '$PASSWORD'"
if ! runuser -u postgres -- psql -qtAc "SELECT 1 FROM pg_database WHERE datname = 'inventory'" | grep -q 1; then
    runuser -u postgres -- psql -q -v ON_ERROR_STOP=1 -f "$DATASETS/postgres.sql" >/dev/null
fi

# ── MySQL ──────────────────────────────────────────────────
mkdir -p /var/run/mysqld && chown mysql:mysql /var/run/mysqld
service mysql start >/dev/null
wait_for mysql -e "SELECT 1"
# Ubuntu makes the folder of the socket readable for everyone through systemd, which is not here.
chmod 755 /var/run/mysqld
# root keeps auth_socket, as Ubuntu installs it. The lab login has a password.
mysql -e "CREATE USER IF NOT EXISTS '$USER_NAME'@'localhost' IDENTIFIED BY '$PASSWORD';
          ALTER USER '$USER_NAME'@'localhost' IDENTIFIED BY '$PASSWORD';
          GRANT ALL PRIVILEGES ON *.* TO '$USER_NAME'@'localhost' WITH GRANT OPTION;"
if [ -z "$(mysql -N -e "SHOW DATABASES LIKE 'inventory'")" ]; then
    mysql --default-character-set=utf8mb4 < "$DATASETS/mysql.sql"
fi

# ── Redis ──────────────────────────────────────────────────
sed -i -E "s/^#? *requirepass .*/requirepass $PASSWORD/" /etc/redis/redis.conf
grep -q "^requirepass $PASSWORD" /etc/redis/redis.conf || echo "requirepass $PASSWORD" >> /etc/redis/redis.conf
service redis-server start >/dev/null
wait_for redis-cli -a "$PASSWORD" --no-auth-warning PING
if [ "$(redis-cli -a "$PASSWORD" --no-auth-warning EXISTS lab:dataset)" != "1" ]; then
    redis-cli -a "$PASSWORD" --no-auth-warning < "$DATASETS/redis.txt" >/dev/null
fi

# ── SQLite ─────────────────────────────────────────────────
HOME_DIR=$(getent passwd "$USER_NAME" | cut -d: -f6)
if [ ! -f "$HOME_DIR/shop.db" ]; then
    sqlite3 "$HOME_DIR/shop.db" < "$DATASETS/sqlite.sql"
    chown "$USER_NAME:$USER_NAME" "$HOME_DIR/shop.db"
fi

touch /run/customer-ready
exec /usr/sbin/sshd -D -e
