### 🔒 Security

- **auth**: A client can no longer get around the rate limits, among them the one on sign-in attempts, or put another address into the audit log by naming it in `X-Forwarded-For`. DBackup reads the header only from a reverse proxy in a private network or one named in `TRUSTED_PROXIES`, which also takes `cloudflare` for the edge servers of Cloudflare.
- **auth**: The rate limits count an IPv6 address by its /64 network, so a client cannot take a new address for every request.

### 📝 Documentation

- **wiki**: The installation guide explains how DBackup finds the address of a client behind a reverse proxy or Cloudflare and when to set `TRUSTED_PROXIES`.
