### 🐛 Bug Fixes

- **updates**: The update notice of an instance on a beta counts the number of a beta as a number, so `beta.10` is newer than `beta.2`.

### 📝 Documentation

- **wiki**: The installation guide explains the beta versions, and the developer guide how to release one.

### 🔧 CI/CD

- **release**: A tag with any suffix, like `v4.1.0-beta.1`, never moves `latest` or the major tag of the image and is published as a pre-release on GitHub.
- **release**: `pnpm version:bump beta` sets the next beta without using up the changelog fragments, and `pnpm release:tag dev` tags it on dev.
- **release**: The notes of a GitHub release come from `pnpm changelog:notes`, for a beta from the fragments with what is new since the beta before it. The workflow makes them before it builds an image.
- **release**: A beta runs the end-to-end tests and keeps the CI image and the README on Docker Hub of the last release.
- **e2e**: The end-to-end tests run on Ubuntu 24.04, since MongoDB 8.0 does not start on the newer kernel of Ubuntu 26.04.
