### 🔒 Security

- **auth**: A client can no longer get around the rate limits, among them the one on sign-in attempts, by naming its own address in `X-Forwarded-For`. DBackup reads the header only from a reverse proxy in a private network or one named in `TRUSTED_PROXIES`, which also keeps the real address in the audit log and the sessions.
- **auth**: The rate limits count an IPv6 address by its /64 network, so a client cannot take a new address for every request.

### 📝 Documentation

- **wiki**: The installation guide explains how DBackup finds the address of a client behind a reverse proxy and when to set `TRUSTED_PROXIES`.
