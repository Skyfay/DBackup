### 🔧 CI/CD

- **ci**: The Debian setup script installs the Firebird 5 client tools `gbak` and `isql` as well as `lz4` and `zstd`, like the Docker image.
- **ci**: The Debian setup script now installs the MongoDB Database Tools on Ubuntu, where its apt source named the wrong component.
- **ci**: The Debian setup script runs through a second time instead of stopping at the PostgreSQL signing key it already wrote.
