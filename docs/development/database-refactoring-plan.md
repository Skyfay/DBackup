# Database Adapter Refactoring Plan

This document outlines the roadmap for refactoring database adapters to support specific database versions (dialects) and separate distinct systems (e.g., MySQL vs. MariaDB) while maintaining shared logic.

## Objectives
1.  **Strict Separation**: Distinct adapters for MySQL and MariaDB in the UI.
2.  **Version Awareness**: Auto-detect database versions during connection tests.
3.  **Dialect Strategy**: Use a "Dialect" pattern to handle version-specific CLI flags and behaviors without code duplication.
4.  **Extensibility**: Ensure the pattern works for PostgreSQL and MongoDB in the future.

---

## Roadmap

### Phase 1: Architecture & Dialect Base
- [x] **Step 1: Define Dialect Interfaces**
    - Create `src/lib/adapters/database/common/dialect.ts`.
    - Define interfaces for `getDumpArgs`, `getRestoreArgs`, `getAuthFlags`, `getVersionQuery`.
    - Create a base abstract class for common functionality.

### Phase 2: Refactor MySQL & MariaDB
- [x] **Step 2: Split Adapters (UI & Registry)**
    - Register a new `mariadb` adapter in `src/lib/adapters/index.ts`.
    - Update `definitions.ts` to have `MySQLSchema` and `MariaDBSchema` (can share most fields but might differ later).
    - Ensure UI shows them as separate entries.
- [ ] **Step 3: Implement MySQL Dialects**
    - Create `src/lib/adapters/database/mysql/dialects/mysql-base.ts`.
    - Implement `MySQL80Dialect` (Standard) and `MySQL57Dialect` (Legacy).
    - Handle flags like `--default-character-set=utf8mb4` vs `utf8`.
- [ ] **Step 4: Implement MariaDB Dialect**
    - Create `src/lib/adapters/database/mysql/dialects/mariadb.ts` (or move to `mariadb/` folder if we split files completely, but keeping shared connection logic is better).
    - Implement `MariaDBDialect` handling `--skip-ssl` instead of `--ssl-mode`.

### Phase 3: Version Detection & integration
- [ ] **Step 5: Implement Version Detection**
    - Update `test-connection` endpoint to run `SELECT VERSION()`.
    - Store the detected version in the adapter config (e.g., `detectedVersion`, `engineVariant`).
    - Display the detected version in the Adapter Form (e.g., a "Verified: MySQL 8.0.35" badge).
- [ ] **Step 6: Wire Dialects into Runner**
    - Modify `dump.ts` and `restore.ts` to instantiate the correct dialect based on the config.
    - Replace hardcoded argument arrays with `dialect.getDumpArgs()`.

### Phase 4: Other Databases (Future/Follow-up)
- [ ] **Step 7: Refactor PostgreSQL**
    - Apply the same pattern for Postgres 14 vs 15 vs 16 (often less critical CLI differences, but good for stability).
- [ ] **Step 8: Refactor MongoDB**
    - Handle `mongodump` versions (e.g., `--uri` support vs older distinct flags).

### Phase 5: Documentation
- [ ] **Step 9: Update Documentation**
    - Update `docs/development/database-adapter-guide.md` to reflect the new Dialect pattern and folder structure.

---

## Technical Details (Dialect Pattern)

```typescript
export interface DatabaseDialect {
    // Generate arguments for the dump command
    getDumpArgs(config: any): string[];

    // Generate arguments for the restore command
    getRestoreArgs(config: any): string[];

    // CLI specific flags for authentication/connection
    getConnectionArgs(config: any): string[];

    // Parse the version string returned by SELECT VERSION()
    parseVersion(versionString: string): { major: number, minor: number, patch: number, variant: string };
}
```
