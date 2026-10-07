### 📝 Documentation

- **wiki**: The development setup lets the setup scripts install Node and pnpm, instead of the newest Node from Homebrew on macOS.

### 🔧 CI/CD

- **ci**: A `.node-version` file pins Node 24 for local development, the version CI and the Docker image use.
- **ci**: The setup scripts for macOS and Debian install Node in the version of `.node-version` and pnpm 10, through fnm on macOS and NodeSource on Debian.
