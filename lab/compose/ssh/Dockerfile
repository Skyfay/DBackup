# The SSH host of the dev lab: SFTP and rsync destination, and the remote host for the SSH mode
# of the database sources. From here the database services are reachable by their service name,
# so a source in SSH mode never needs a published database port.
#
# The clients are those of Debian 12, chosen against the oldest server of the "core" profile,
# since a dump tool refuses a server newer than itself: postgresql-client 15 reads PostgreSQL 12,
# mariadb-client 10.11 reads MariaDB 10.4 and MySQL 5.7.
FROM debian:12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        openssh-server \
        openssh-client \
        rsync \
        mariadb-client \
        postgresql-client \
        redis-tools \
        sqlite3 \
        procps \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# One user with a password, the way a NAS or a plain server is set up. MSSQL in SSH mode
# tunnels its connection, so TCP forwarding stays on.
RUN useradd --create-home --shell /bin/bash dbackup \
    && echo 'dbackup:dbackup-password' | chpasswd \
    && mkdir -p /run/sshd /etc/ssh/sshd_config.d \
    && printf '%s\n' \
        'PermitRootLogin no' \
        'PasswordAuthentication yes' \
        'AllowTcpForwarding yes' \
        > /etc/ssh/sshd_config.d/10-dbackup-lab.conf

COPY datasets/sqlite.sql /opt/lab/sqlite.sql
COPY compose/ssh/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 22
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
