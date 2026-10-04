# Rate Limiting

The rate limiting system protects the application from abuse by limiting how many requests a client can send within a configurable time window.

## Architecture

Rate limiting spans two Next.js runtime contexts with different capabilities:

```
┌─────────────────────────────────────────────────────┐
│  Edge Runtime (Middleware)                           │
│  • Cannot use Prisma or Node.js APIs                │
│  • Fetches config via internal HTTP endpoint        │
│  • Maintains in-memory RateLimiterMemory instances  │
│  • Enforces limits on every request                 │
└──────────────────┬──────────────────────────────────┘
                   │ fetch (30s TTL cache)
                   ▼
┌─────────────────────────────────────────────────────┐
│  Node.js Runtime (Server)                           │
│  • Reads config from SystemSetting DB table         │
│  • Serves config via /api/internal/rate-limit-config│
│  • reloadRateLimits() called on startup + settings  │
└─────────────────────────────────────────────────────┘
```

### Why This Architecture?

Next.js middleware runs in the **Edge Runtime**, which cannot use Prisma, `fs`, or other Node.js-only APIs. The rate limit config is stored in the database (SQLite via Prisma), so the middleware cannot read it directly.

**Solution:** An internal API endpoint (`/api/internal/rate-limit-config`) runs in the Node.js runtime and serves the current config as JSON. The middleware fetches this endpoint with a 30-second TTL cache.

## Key Files

```
src/lib/rate-limit/
├── index.ts    → Limiters, config constants, getters (applyExternalConfig, RATE_LIMIT_DEFAULTS, RATE_LIMIT_KEYS)
└── server.ts   → Server-only functions: reloadRateLimits(), getRateLimitConfig() (uses Prisma)
src/middleware.ts                             → Enforcement: fetch config, consume limits
src/app/api/internal/rate-limit-config/route.ts → Internal endpoint: serves DB config
src/app/actions/settings/rate-limit-settings.ts        → Server action: save the limits
src/services/system/rate-limit-settings-service.ts     → Writes the keys and reloads the limiters
src/components/dashboard/settings/rate-limits-part.tsx → The Rate limits part of the Settings page, with the save bar
```

## Rate Limit Module (`src/lib/rate-limit/`)

### Exports

| Export | Context | Description |
| :--- | :--- | :--- |
| `getAuthLimiter()` | Any | Returns the `RateLimiterMemory` instance for auth |
| `getApiLimiter()` | Any | Returns the `RateLimiterMemory` instance for API reads |
| `getMutationLimiter()` | Any | Returns the `RateLimiterMemory` instance for mutations |
| `applyExternalConfig(config)` | Edge | Rebuilds the limiters whose limit changed, the others keep their counters |
| `reloadRateLimits()` | Server only | Reads DB via Prisma, rebuilds local limiters |
| `getRateLimitConfig()` | Server only | Reads DB and returns config for UI display |
| `RATE_LIMIT_DEFAULTS` | Any | Default values: auth 5/60s, api 100/60s, mutation 20/60s |
| `RATE_LIMIT_KEYS` | Any | SystemSetting key constants |

### Config Flow

1. **Server startup** - `instrumentation.ts` calls `reloadRateLimits()` → reads DB → rebuilds limiters in server context
2. **Settings change** - Server action calls `reloadRateLimits()` → updates server context limiters
3. **Middleware request** - `syncRateLimitConfig()` fetches `/api/internal/rate-limit-config` (cached 30s) → calls `applyExternalConfig()` → rebuilds the Edge limiters whose limit changed

A new `RateLimiterMemory` starts counting from zero, so `applyExternalConfig()` keeps a limiter whose points and duration are the ones it already has. Rebuilding all of them on every sync started every counter over each 30 seconds.

## Middleware Integration

The middleware in `src/middleware.ts` handles rate limiting:

```typescript
// Rate limit config cache (fetched from internal API)
let _cachedConfig: RateLimitConfig | null = null;
let _configFetchedAt = 0;
const CONFIG_TTL_MS = 30_000; // 30 seconds

async function syncRateLimitConfig(origin: string): Promise<void> {
    if (_cachedConfig && Date.now() - _configFetchedAt < CONFIG_TTL_MS) return;
    const res = await fetch(new URL("/api/internal/rate-limit-config", origin));
    if (res.ok) {
        const config = await res.json();
        applyExternalConfig(config);
        _cachedConfig = config;
        _configFetchedAt = Date.now();
    }
}
```

The middleware matcher **excludes** `/api/internal/` to avoid an infinite loop:

```typescript
export const config = {
    matcher: [
        '/((?!api/auth|api/internal|_next/static|_next/image|favicon.ico|uploads/).*)',
    ],
};
```

## Database Storage

Rate limit values are stored in the `SystemSetting` table (key-value store):

| Key | Example Value | Description |
| :--- | :--- | :--- |
| `rateLimit.auth.points` | `5` | Auth: max requests |
| `rateLimit.auth.duration` | `60` | Auth: window in seconds |
| `rateLimit.api.points` | `100` | API read: max requests |
| `rateLimit.api.duration` | `60` | API read: window in seconds |
| `rateLimit.mutation.points` | `20` | Mutation: max requests |
| `rateLimit.mutation.duration` | `60` | Mutation: window in seconds |

If no values exist in the DB, the defaults from `RATE_LIMIT_DEFAULTS` are used.

## Server Action

The server action in `src/app/actions/settings/rate-limit-settings.ts` follows the standard pattern:

```typescript
export async function updateRateLimitSettings(data: RateLimitFormData) {
    const user = await checkPermission(PERMISSIONS.SETTINGS.WRITE);
    // Zod validation → saveRateLimitConfig() ($transaction of upserts, reloadRateLimits()) → audit → revalidatePath
}
```

**Reset to defaults** in the part puts the defaults into its fields, which the save bar saves like any other change.

## Internal API Endpoint

`/api/internal/rate-limit-config` is a simple unauthenticated GET endpoint:

```typescript
export const dynamic = "force-dynamic";

export async function GET() {
    const config = await getRateLimitConfig();
    return NextResponse.json(config);
}
```

::: warning
This endpoint is excluded from middleware matching and has no authentication. It only exposes rate limit numbers (not sensitive data). If you add other internal endpoints, ensure they follow the same pattern.
:::

## Adding New Rate Limit Categories

1. Add default values to `RATE_LIMIT_DEFAULTS` in `src/lib/rate-limit.ts`
2. Add `SystemSetting` keys to `RATE_LIMIT_KEYS`
3. Add a new `RateLimiterMemory` instance in `_limiters`
4. Add a getter function (e.g., `getNewLimiter()`)
5. Update `rebuildLimiters()` to include the new limiter
6. Add the matching `consume()` call in the middleware
7. Add form fields in `src/components/settings/rate-limit-settings.tsx`
8. Add entries in the server action schema and upsert logic
