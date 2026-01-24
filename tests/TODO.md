# Test Coverage TODOs

This list contains critical unit tests that need to be implemented to ensure application robustness and security.

## Security

- [x] **Crypto Stream Integrity** (`tests/unit/lib/crypto-stream.test.ts`)
    - **Goal:** Ensure manipulated encrypted data (bit-flipping, corrupt auth tags) is detected immediately.
    - **Expectation:** The decryption stream must abort and throw an authentication error before data is accepted as valid.

- [x] **Storage Path Traversal** (`tests/unit/adapters/storage/local-security.test.ts`)
    - **Goal:** Prevent `LocalStorageAdapter` from writing/reading files outside the configured `basePath`.
    - **Expectation:** Paths like `../../etc/passwd` must be detected and rejected with an error.

## Async Logic & Concurrency

- [x] **Queue Manager Concurrency** (`tests/unit/lib/queue-manager.test.ts`)
    - **Goal:** Validate that the `maxConcurrentJobs` setting is strictly enforced, even under load spikes.
    - **Expectation:** If the limit is reached, no new jobs may start until a slot becomes free.

## Resilience

- [ ] **Runner Cleanup on Failure** (`tests/unit/runner/pipeline-failure.test.ts`)
    - **Goal:** Ensure temporary files (dumps) are deleted even if a later step in the backup process fails.
    - **Expectation:** `stepCleanup` must be called in case of error (e.g., upload failed) to prevent disk space leaks.
