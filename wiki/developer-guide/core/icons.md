# Icon System

DBackup uses **[Iconify](https://iconify.design/)** for adapter icons — brand logos for databases, storage providers, and notifications. Icons are **bundled offline** (no API calls at runtime), which is critical for self-hosted deployments.

## Architecture

```
src/components/adapter/
├── utils.ts           # Icon & color mapping (getAdapterIcon, getAdapterColor)
├── adapter-icon.tsx   # <AdapterIcon> component (renders Iconify <Icon>)
├── adapter-picker.tsx # Uses <AdapterIcon> in adapter selection grid
└── adapter-card.tsx   # Uses <AdapterIcon> in adapter config cards
```

### Icon Packs (Priority Order)

| Pack | NPM Package | Usage | Coloring |
|------|------------|-------|----------|
| **SVG Logos** | `@iconify-icons/logos` | Primary — multi-colored brand icons | Colors embedded in SVG |
| **Simple Icons** | `@iconify-icons/simple-icons` | Fallback — brands not in SVG Logos | Monochrome, brand color via `ADAPTER_COLOR_MAP` |
| **Material Design Icons** | `@iconify-icons/mdi` | Protocol, storage & generic icons (SSH, FTP, SMB, email, fallback) | Inherits `currentColor` |

> **Rule:** Always prefer **SVG Logos** first. Only use **Simple Icons** if the brand doesn't exist in SVG Logos (e.g. Hetzner, Minio). Use **MDI** for protocol/storage concepts and generic icons (SSH, FTP, email, fallback).

### Browsing Available Icons

- SVG Logos: [https://icon-sets.iconify.design/logos/](https://icon-sets.iconify.design/logos/)
- Simple Icons: [https://icon-sets.iconify.design/simple-icons/](https://icon-sets.iconify.design/simple-icons/)
- Material Design Icons: [https://icon-sets.iconify.design/mdi/](https://icon-sets.iconify.design/mdi/)

## How It Works

### Bundled Icon Data

Icons are imported as **static data objects** from `@iconify-icons/*` packages (tree-shakeable, one file per icon). This avoids runtime API calls to `api.iconify.design`:

```typescript
// src/components/adapter/utils.ts
import mysqlIcon from "@iconify-icons/logos/mysql-icon";
import hetznerIcon from "@iconify-icons/simple-icons/hetzner";
import emailIcon from "@iconify-icons/mdi/email";
```

### Icon Map

The `ADAPTER_ICON_MAP` maps each adapter ID to its `IconifyIcon` data object:

```typescript
const ADAPTER_ICON_MAP: Record<string, IconifyIcon> = {
    "mysql": mysqlIcon,          // logos (multi-colored)
    "s3-hetzner": hetznerIcon,   // simple-icons (monochrome + brand color)
    "sftp": sshIcon,             // mdi (protocol)
};
```

### Color Map

Only **Simple Icons** (monochrome) entries need a brand color. SVG Logos have colors baked in, and Lucide icons inherit `currentColor`:

```typescript
const ADAPTER_COLOR_MAP: Record<string, string> = {
    "mssql": "#CC2927",
    "s3-generic": "#C72E49",
    "s3-hetzner": "#D50C2D",
};
```

### AdapterIcon Component

The `<AdapterIcon>` component handles everything — it reads the icon data and optional color, then renders via Iconify's `<Icon>`:

```tsx
// Usage
<AdapterIcon adapterId="mysql" className="h-8 w-8" />
<AdapterIcon adapterId="s3-hetzner" className="h-5 w-5" />
```

## Adding an Icon for a New Adapter

### Step 1: Find the icon

1. Search [SVG Logos](https://icon-sets.iconify.design/logos/) first
2. If not found, search [Simple Icons](https://icon-sets.iconify.design/simple-icons/)
3. If neither has a brand icon, use an [MDI](https://icon-sets.iconify.design/mdi/) generic icon

Note the icon name from the URL (e.g. `logos:mysql-icon` → import path is `@iconify-icons/logos/mysql-icon`).

### Step 2: Add the import

In `src/components/adapter/utils.ts`, add the import at the top in the appropriate section:

```typescript
// — SVG Logos (primary, multi-colored) —
import myBrandIcon from "@iconify-icons/logos/my-brand-icon";

// — OR Simple Icons (if not in SVG Logos) —
import myBrandIcon from "@iconify-icons/simple-icons/mybrand";

// — OR MDI (generic) —
import myGenericIcon from "@iconify-icons/mdi/some-icon";
```

### Step 3: Add to ADAPTER_ICON_MAP

```typescript
const ADAPTER_ICON_MAP: Record<string, IconifyIcon> = {
    // ... existing entries
    "my-adapter": myBrandIcon,
};
```

### Step 4: Add brand color (Simple Icons only)

If you used a Simple Icons icon, add the brand hex color to `ADAPTER_COLOR_MAP`:

```typescript
const ADAPTER_COLOR_MAP: Record<string, string> = {
    // ... existing entries
    "my-adapter": "#FF6600",  // Brand color from simpleicons.org
};
```

::: tip
SVG Logos icons already contain their brand colors — do **not** add them to `ADAPTER_COLOR_MAP` or the colors will be overridden.
:::

### Step 5: Verify

```bash
# Check the icon exists in the package
node -e "try { require('@iconify-icons/logos/my-brand-icon'); console.log('OK') } catch { console.log('MISSING') }"

# Build to verify
pnpm build
```

## Current Icon Mapping

| Adapter ID | Icon Pack | Icon Name |
|-----------|-----------|-----------|
| `mysql` | SVG Logos | `logos/mysql-icon` |
| `mariadb` | SVG Logos | `logos/mariadb-icon` |
| `postgres` | SVG Logos | `logos/postgresql` |
| `mongodb` | SVG Logos | `logos/mongodb-icon` |
| `sqlite` | SVG Logos | `logos/sqlite` |
| `redis` | SVG Logos | `logos/redis` |
| `mssql` | Simple Icons | `simple-icons/microsoftsqlserver` |
| `s3-aws` | SVG Logos | `logos/aws-s3` |
| `s3-generic` | Simple Icons | `simple-icons/minio` |
| `s3-r2` | SVG Logos | `logos/cloudflare-icon` |
| `s3-hetzner` | Simple Icons | `simple-icons/hetzner` |
| `google-drive` | SVG Logos | `logos/google-drive` |
| `dropbox` | SVG Logos | `logos/dropbox` |
| `onedrive` | SVG Logos | `logos/microsoft-onedrive` |
| `discord` | SVG Logos | `logos/discord-icon` |
| `local-filesystem` | MDI | `mdi/harddisk` |
| `sftp` | MDI | `mdi/ssh` |
| `ftp` | MDI | `mdi/swap-vertical` |
| `webdav` | MDI | `mdi/cloud-upload` |
| `smb` | MDI | `mdi/folder-network` |
| `rsync` | MDI | `mdi/folder-sync` |
| `email` | MDI | `mdi/email` |
| *(fallback)* | MDI | `mdi/disc` |

## Key Decisions

- **Why bundled, not API?** — DBackup is self-hosted. Users may not have internet access or may block external API calls via CSP. Bundled icons render instantly without network requests.
- **Why Iconify over react-simple-icons?** — Iconify's SVG Logos pack provides multi-colored brand icons (MySQL dolphin in blue, PostgreSQL elephant in blue/white, etc.) rather than flat monochrome. It also covers more brands (OneDrive, AWS S3).
- **Why three packs?** — SVG Logos has the best brand icons but doesn't cover everything. Simple Icons fills the gaps (Hetzner, Minio). MDI provides expressive protocol icons (SSH lock, folder-network for SMB, folder-sync for rsync) as well as generic icons (email, disc fallback), eliminating the need for a separate Lucide pack.
