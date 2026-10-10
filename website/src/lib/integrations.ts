import en from "@/i18n/messages/en.json";
import type { Messages } from "@/i18n/translate";
import { DOCS_URL } from "@/lib/content";

/** A database adapter with a card on the integrations page, from the keys of its text. */
export type DatabaseCardId = keyof Messages["integrations"]["cards"];
/** A storage or notification adapter with a line on what it is, from the keys of that line. */
export type AdapterKindId = keyof Messages["integrations"]["kinds"];

export function isDatabaseCardId(id: string): id is DatabaseCardId {
  return Object.hasOwn(en.integrations.cards, id);
}

export function isAdapterKindId(id: string): id is AdapterKindId {
  return Object.hasOwn(en.integrations.kinds, id);
}

/** The tool each engine is backed up with, a command in every language. */
export const DUMP_TOOL: Record<DatabaseCardId, string> = {
  postgres: "pg_dump",
  mysql: "mariadb-dump",
  mariadb: "mariadb-dump",
  mongodb: "mongodump",
  sqlite: "sqlite3 .backup",
  redis: "redis-cli --rdb",
  valkey: "redis-cli --rdb",
  mssql: "BACKUP DATABASE",
  "azure-sql": "SqlPackage",
  firebird: "gbak",
};

/** The color of each brand, for the glow behind its card and its page. */
export const DATABASE_COLORS: Record<DatabaseCardId, string> = {
  postgres: "#336791",
  mysql: "#00758f",
  mariadb: "#c0765a",
  mongodb: "#47a248",
  sqlite: "#0f80cc",
  redis: "#dc382d",
  valkey: "#3b82f6",
  mssql: "#cc2927",
  "azure-sql": "#0089d6",
  firebird: "#f97316",
};

/** The databases with a page of their own under /integrations/<slug>/, in the order the site lists them. */
export const DATABASE_SLUGS = ["postgresql", "mysql", "mariadb", "mongodb", "redis"] as const;
export type DatabaseSlug = (typeof DATABASE_SLUGS)[number];

export function isDatabaseSlug(value: string): value is DatabaseSlug {
  return (DATABASE_SLUGS as readonly string[]).includes(value);
}

/** The name of each engine, the same in every language. */
export const DATABASE_NAMES: Record<DatabaseSlug, string> = {
  postgresql: "PostgreSQL",
  mysql: "MySQL",
  mariadb: "MariaDB",
  mongodb: "MongoDB",
  redis: "Redis",
};

/** The page of an adapter, or undefined when it has none yet. */
export function pageOfAdapter(adapterId: string): DatabaseSlug | undefined {
  return DATABASE_SLUGS.find((slug) => DATABASE_PAGES[slug].adapter === adapterId);
}

/** The guide of an adapter in the docs, for the ones without a page here. */
export function adapterDocsUrl(kind: "database" | "storage" | "notification", id: string): string {
  if (kind === "notification") return `${DOCS_URL}/user-guide/notifications/${id}`;
  if (kind === "database") return `${DOCS_URL}/user-guide/sources/${id}`;
  if (id === "docker-volume") return `${DOCS_URL}/user-guide/sources/docker-volumes`;
  if (id === "local-filesystem") return `${DOCS_URL}/user-guide/destinations/local`;
  return `${DOCS_URL}/user-guide/destinations/${id}`;
}

/** An entry of the archive a run writes, as `tar -tf` lists an unencrypted one. */
export interface ArchiveEntry {
  name: string;
  depth: 0 | 1 | 2;
  kind: "tar" | "file" | "folder" | "dump";
  size?: string;
}

/** What the section on the engine shows beside its text. */
export type FeatureVisual = "compression" | "options" | "hosts" | "restore-guide";

/** The parts of a database page that are commands, files and code, the same in every language. */
export interface DatabasePageData {
  adapter: DatabaseCardId;
  /** The guide of the engine in the docs. */
  docs: string;
  feature: FeatureVisual;
  /** The demo run: the job, the host it connects to, the dump command and its size, and whether DBackup compresses. */
  run: { job: string; host: string; dump: string; size: string; version: string; gzip: boolean };
  archive: ArchiveEntry[];
  /** The commands of a restore without DBackup, the Recovery Kit first. */
  recovery: string[];
  /** The service of the database in the compose file, and the host and port the form takes. */
  service: { name: string; yaml: string; port: string };
  /** The login DBackup gets, with the language of its snippet. */
  access: { file: string; lang: "sql" | "javascript" | "shell"; code: string };
  /** Whether the form asks for the authentication database. */
  authDatabase?: boolean;
  related: DatabaseSlug[];
}

const COMPOSE_DBACKUP = `services:
  dbackup:
    image: skyfay/dbackup:latest
    restart: always
    ports:
      - "3000:3000"
    environment:
      - ENCRYPTION_KEY=\${ENCRYPTION_KEY}          # openssl rand -hex 32
      - BETTER_AUTH_SECRET=\${BETTER_AUTH_SECRET}  # openssl rand -base64 32
      - BETTER_AUTH_URL=https://localhost:3000
    volumes:
      - ./data:/data
`;

/** The compose file of a page: DBackup and the database on the network compose gives them. */
export function composeFile(page: DatabasePageData): string {
  return `${COMPOSE_DBACKUP}\n${page.service.yaml}`;
}

const MYSQL_GRANTS = `CREATE USER 'dbackup'@'%' IDENTIFIED BY 'change-me';
GRANT SELECT, SHOW VIEW, TRIGGER, LOCK TABLES, EVENT ON *.* TO 'dbackup'@'%';`;

const kit = (archive: string, entry: string) =>
  `$ node dbackup-recover.js --extract ${archive} ./restored databases/${entry}`;

export const DATABASE_PAGES: Record<DatabaseSlug, DatabasePageData> = {
  postgresql: {
    adapter: "postgres",
    docs: `${DOCS_URL}/user-guide/sources/postgresql`,
    feature: "compression",
    run: { job: "shop-postgres", host: "postgres:5432", dump: "pg_dump -F c -Z zstd:3 -d shop", size: "412 MB", version: "17.6", gzip: false },
    archive: [
      { name: "shop-postgres_2026-10-08_03-00-00.tar", depth: 0, kind: "tar", size: "1.3 GB" },
      { name: "manifest.json", depth: 1, kind: "file" },
      { name: "databases/", depth: 1, kind: "folder" },
      { name: "shop.dump", depth: 2, kind: "dump", size: "412 MB" },
      { name: "crm.dump", depth: 2, kind: "dump", size: "268 MB" },
      { name: "analytics.dump", depth: 2, kind: "dump", size: "640 MB" },
      { name: "index", depth: 1, kind: "file" },
    ],
    recovery: [
      kit("shop-postgres_2026-10-08_03-00-00.tar", "shop"),
      "$ createdb shop",
      "$ pg_restore --no-owner -d shop ./restored/databases/shop.dump",
    ],
    service: {
      name: "postgres",
      port: "5432",
      yaml: `  postgres:
    image: postgres:18
    environment:
      - POSTGRES_PASSWORD=\${POSTGRES_PASSWORD}
`,
    },
    access: {
      file: "backup-user.sql",
      lang: "sql",
      code: `CREATE USER dbackup WITH PASSWORD 'change-me';

-- PostgreSQL 14 and newer, every database
GRANT pg_read_all_data TO dbackup;

-- Older servers, one database at a time
GRANT CONNECT ON DATABASE shop TO dbackup;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO dbackup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO dbackup;`,
    },
    related: ["mysql", "mariadb", "mongodb", "redis"],
  },
  mysql: {
    adapter: "mysql",
    docs: `${DOCS_URL}/user-guide/sources/mysql`,
    feature: "options",
    run: {
      job: "shop-mysql",
      host: "mysql:3306",
      dump: "mariadb-dump --single-transaction --routines --events --databases shop",
      size: "286 MB",
      version: "9.1.0",
      gzip: true,
    },
    archive: [
      { name: "shop-mysql_2026-10-08_03-00-00.tar", depth: 0, kind: "tar", size: "182 MB" },
      { name: "manifest.json", depth: 1, kind: "file" },
      { name: "databases/", depth: 1, kind: "folder" },
      { name: "shop.sql.gz", depth: 2, kind: "dump", size: "96 MB" },
      { name: "blog.sql.gz", depth: 2, kind: "dump", size: "41 MB" },
      { name: "crm.sql.gz", depth: 2, kind: "dump", size: "45 MB" },
      { name: "index", depth: 1, kind: "file" },
    ],
    recovery: [kit("shop-mysql_2026-10-08_03-00-00.tar", "shop"), "$ mariadb -u root -p < ./restored/databases/shop.sql"],
    service: {
      name: "mysql",
      port: "3306",
      yaml: `  mysql:
    image: mysql:9
    environment:
      - MYSQL_ROOT_PASSWORD=\${MYSQL_ROOT_PASSWORD}
`,
    },
    access: { file: "backup-user.sql", lang: "sql", code: MYSQL_GRANTS },
    related: ["mariadb", "postgresql", "mongodb", "redis"],
  },
  mariadb: {
    adapter: "mariadb",
    docs: `${DOCS_URL}/user-guide/sources/mysql`,
    feature: "options",
    run: {
      job: "wiki-mariadb",
      host: "mariadb:3306",
      dump: "mariadb-dump --single-transaction --routines --events --databases nextcloud",
      size: "534 MB",
      version: "11.4.5",
      gzip: true,
    },
    archive: [
      { name: "wiki-mariadb_2026-10-08_03-00-00.tar", depth: 0, kind: "tar", size: "164 MB" },
      { name: "manifest.json", depth: 1, kind: "file" },
      { name: "databases/", depth: 1, kind: "folder" },
      { name: "nextcloud.sql.gz", depth: 2, kind: "dump", size: "121 MB" },
      { name: "wiki.sql.gz", depth: 2, kind: "dump", size: "43 MB" },
      { name: "index", depth: 1, kind: "file" },
    ],
    recovery: [
      kit("wiki-mariadb_2026-10-08_03-00-00.tar", "nextcloud"),
      "$ mariadb -u root -p < ./restored/databases/nextcloud.sql",
    ],
    service: {
      name: "mariadb",
      port: "3306",
      yaml: `  mariadb:
    image: mariadb:11
    environment:
      - MARIADB_ROOT_PASSWORD=\${MARIADB_ROOT_PASSWORD}
`,
    },
    access: { file: "backup-user.sql", lang: "sql", code: MYSQL_GRANTS },
    related: ["mysql", "postgresql", "mongodb", "redis"],
  },
  mongodb: {
    adapter: "mongodb",
    docs: `${DOCS_URL}/user-guide/sources/mongodb`,
    feature: "hosts",
    run: {
      job: "app-mongodb",
      host: "cluster0.abcde.mongodb.net",
      dump: "mongodump --db app --archive=app.archive --gzip",
      size: "218 MB",
      version: "8.0.4",
      gzip: false,
    },
    archive: [
      { name: "app-mongodb_2026-10-08_03-00-00.tar", depth: 0, kind: "tar", size: "301 MB" },
      { name: "manifest.json", depth: 1, kind: "file" },
      { name: "databases/", depth: 1, kind: "folder" },
      { name: "app.archive", depth: 2, kind: "dump", size: "218 MB" },
      { name: "analytics.archive", depth: 2, kind: "dump", size: "83 MB" },
      { name: "index", depth: 1, kind: "file" },
    ],
    recovery: [
      kit("app-mongodb_2026-10-08_03-00-00.tar", "app"),
      "$ mongorestore --gzip --archive=./restored/databases/app.archive",
    ],
    service: {
      name: "mongo",
      port: "27017",
      yaml: `  mongo:
    image: mongo:8
    environment:
      - MONGO_INITDB_ROOT_USERNAME=root
      - MONGO_INITDB_ROOT_PASSWORD=\${MONGO_PASSWORD}
`,
    },
    access: {
      file: "mongosh",
      lang: "javascript",
      code: `use admin
db.createUser({
  user: "dbackup",
  pwd: "change-me",
  roles: [
    { role: "backup", db: "admin" },
    { role: "restore", db: "admin" }
  ]
})`,
    },
    authDatabase: true,
    related: ["postgresql", "mysql", "redis", "mariadb"],
  },
  redis: {
    adapter: "redis",
    docs: `${DOCS_URL}/user-guide/sources/redis`,
    feature: "restore-guide",
    run: { job: "cache-redis", host: "redis:6379", dump: "redis-cli --rdb dump.rdb", size: "64 MB", version: "8.0.2", gzip: true },
    archive: [
      { name: "cache-redis_2026-10-08_03-00-00.tar", depth: 0, kind: "tar", size: "21 MB" },
      { name: "manifest.json", depth: 1, kind: "file" },
      { name: "databases/", depth: 1, kind: "folder" },
      { name: "dump.rdb.gz", depth: 2, kind: "dump", size: "21 MB" },
      { name: "index", depth: 1, kind: "file" },
    ],
    recovery: [
      kit("cache-redis_2026-10-08_03-00-00.tar", "dump"),
      "$ sudo systemctl stop redis-server",
      "$ sudo install -o redis -g redis -m 640 ./restored/databases/dump.rdb /var/lib/redis/dump.rdb",
      "$ sudo systemctl start redis-server",
    ],
    service: {
      name: "redis",
      port: "6379",
      yaml: `  redis:
    image: redis:8
    command: redis-server --requirepass \${REDIS_PASSWORD}
`,
    },
    access: { file: "redis-cli", lang: "shell", code: "ACL SETUSER dbackup on >change-me +sync +psync +ping +info" },
    related: ["postgresql", "mongodb", "mysql", "mariadb"],
  },
};
