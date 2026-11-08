# A customer server for the end-to-end tests: Ubuntu 24.04 with PostgreSQL, MySQL, Redis and
# SQLite from its packages, the way most servers DBackup backs up run them, and OpenSSH with a
# login without root. The entrypoint sets them up and loads the datasets of the lab on each start.
# MongoDB is left out, Ubuntu does not package it.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update -qq \
    && apt-get install -y -qq --no-install-recommends postgresql-16 mysql-server redis-server sqlite3 rsync openssh-server \
    && rm -rf /var/lib/apt/lists/*

COPY datasets /opt/dbackup-lab/datasets
COPY compose/customer/entrypoint.sh /usr/local/bin/customer-entrypoint.sh
RUN chmod +x /usr/local/bin/customer-entrypoint.sh

EXPOSE 22
HEALTHCHECK --interval=2s --timeout=5s --retries=90 CMD test -f /run/customer-ready
ENTRYPOINT ["/usr/local/bin/customer-entrypoint.sh"]
