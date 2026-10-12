#!/bin/sh
set -e

# Host keys belong to the container, never to the image or the repository.
ssh-keygen -A

# SQLite has no server: a source names a file on the host. The home folder is a volume, so the
# database keeps what a restore wrote into it.
if [ ! -f /home/dbackup/shop.db ]; then
    sqlite3 /home/dbackup/shop.db < /opt/lab/sqlite.sql
    chown dbackup:dbackup /home/dbackup/shop.db
fi

# Every workspace writes its backups into a folder of its own below this one.
mkdir -p /home/dbackup/backups
chown dbackup:dbackup /home/dbackup /home/dbackup/backups

exec /usr/sbin/sshd -D -e
