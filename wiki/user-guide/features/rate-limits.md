# Rate Limits

Configure how many requests clients can send to the application within a given time window. Rate limits protect against brute-force attacks, API abuse, and accidental request floods.

## Overview

DBackup enforces rate limits at the middleware level — every incoming request is checked before reaching any route handler. Limits are applied **per IP address** and are split into three categories:

| Category | Applies To | Default |
| :--- | :--- | :--- |
| **Authentication** | Login attempts (`/api/auth/sign-in`) | 5 requests / 60 seconds |
| **API Read** | All `GET` / `HEAD` requests to `/api/*` | 100 requests / 60 seconds |
| **API Write** | All `POST` / `PUT` / `DELETE` requests to `/api/*` | 20 requests / 60 seconds |

When a client exceeds the limit, the server responds with **HTTP 429 Too Many Requests** until the time window resets.

## Configuring Rate Limits

Navigate to **Settings → Rate Limits** to adjust the limits.

### Rate Limit Categories

Each category has two settings:

- **Max Requests**: The maximum number of requests allowed within the time window
- **Time Window (seconds)**: The duration in seconds before the request counter resets

### Authentication

Controls login attempt rate limiting. Keep this low to protect against brute-force password attacks.

::: warning
Setting authentication rate limits too high weakens brute-force protection. The default of 5 attempts per 60 seconds is recommended for most deployments.
:::

### API Read

Controls the rate of read-only API requests (GET/HEAD). This includes dashboard data loading, file listing, and status polling. Increase this if you have many concurrent users or API integrations polling frequently.

### API Write

Controls the rate of write operations (POST/PUT/DELETE). This includes creating jobs, triggering backups, changing settings, and other mutations.

## Auto-Save

Changes are saved automatically after a short delay (800ms debounce). A toast notification confirms each save. No "Save" button is needed.

## Reset to Defaults

Click the **Reset to Defaults** button at the top of the Rate Limits tab to restore all values to their defaults:

| Category | Max Requests | Time Window |
| :--- | :--- | :--- |
| Authentication | 5 | 60s |
| API Read | 100 | 60s |
| API Write | 20 | 60s |

## How It Works

Rate limits are enforced in the Next.js middleware, which runs on every request. The middleware uses in-memory counters (via `rate-limiter-flexible`) per IP address.

::: info
After changing rate limit settings, the middleware picks up the new values within **30 seconds**. No server restart is required.
:::

## API Key Requests

Requests authenticated with API keys are subject to the same rate limits as browser-session requests. Rate limiting is always based on the client's IP address, regardless of authentication method.
