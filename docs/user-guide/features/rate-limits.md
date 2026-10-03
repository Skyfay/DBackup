# Rate Limits

Configure how many requests clients can send to the application within a given time window. Rate limits protect against brute-force attacks, API abuse, and accidental request floods.

## Overview

DBackup enforces rate limits at the middleware level - every incoming request is checked before reaching any route handler. Limits are applied **per IP address** and are split into three categories:

| Limit | Applies To | Default |
| :--- | :--- | :--- |
| **Sign-ins** | Login attempts (`/api/auth/sign-in`) | 5 requests / 60 seconds |
| **Reads through the API** | All `GET` / `HEAD` requests to `/api/*` | 100 requests / 60 seconds |
| **Changes through the API** | All `POST` / `PUT` / `DELETE` requests to `/api/*` | 20 requests / 60 seconds |

When a client exceeds the limit, the server responds with **HTTP 429 Too Many Requests** until the time window is over.

## Configuring Rate Limits

Go to **Settings → Rate limits**. Each limit reads as a sentence, like `5 requests every 60 seconds per address`, with its default beside it:

- **Requests**: how many requests one address may make within the window, from 1 up to 1000 (10000 for reads).
- **Seconds**: the length of the window, from 10 to 3600 seconds.

A change waits in the bar at the foot of the part until **Save changes**. **Reset to defaults** puts the defaults into the fields, which also wait for **Save changes**.

### Sign-ins

Slows down guessing passwords on the login page. Keep it low.

::: warning
A higher limit for sign-ins weakens the protection against guessing passwords. The default of 5 attempts per 60 seconds suits most deployments.
:::

### Reads Through the API

Every `GET` to `/api`, from the browser and from API keys, like the data of the dashboard, file lists and status polling. Raise it for many users at once or for integrations that poll often.

### Changes Through the API

Every `POST`, `PUT` and `DELETE` to `/api`, like triggering a job through its API or an upload. Changes made in the app itself go through Server Actions, which these limits do not count.

## How It Works

Rate limits are enforced in the Next.js middleware, which runs on every request. The middleware uses in-memory counters (via `rate-limiter-flexible`) per IP address.

::: info
After a change the middleware picks up the new limits within **30 seconds**, without a restart. A limit that did not change keeps its counters, so a window always counts its full length.
:::

## API Key Requests

Requests authenticated with API keys are subject to the same rate limits as browser-session requests. Rate limiting is always based on the client's IP address, regardless of authentication method.
