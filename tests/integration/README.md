
# Integration Testing Strategy

This folder contains integration tests that run against real database instances.
Because these tests require Docker containers (Postgres, MySQL, Mongo), they are **not** run by default with `npm test`.

## Prerequisites

1.  Docker must be running.
2.  Install dependencies: `npm install`

## How to Run

Ideally, use a specialized runner or variable:

```bash
# Run all integration tests (WARNING: Heavy)
npm run test:integration
```

## Structure

We verify:
1.  **Connectivity** (test method)
2.  **Backup** (dump)
3.  **Restore** (restore)

For the following versions:
*   PostgreSQL: 12, 16
*   MySQL: 5.7, 8
*   MariaDB: 10
*   MongoDB: 6

(Note: We test a subset of versions to keep CI time reasonable, assuming intermediate versions work if edges work).
