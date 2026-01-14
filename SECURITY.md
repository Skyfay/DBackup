# Security Audit & Remediation Plan

**Date:** January 14, 2026
**Status:** In Progress

## Executive Summary

This document outlines the security vulnerabilities identified during the audit of the Database Backup Manager project. Several critical issues regarding API authentication and potential Remote Code Execution (RCE) were found. Immediate action is required to secure the application.

## Identified Vulnerabilities

### 1. Unauthenticated API Routes (Critical)
*   **Location:** `src/app/api/adapters/route.ts` (and potentially others in `src/app/api/`)
*   **Issue:** The API endpoints do not check for an active user session.
*   **Impact:**
    *   **Information Disclosure:** Unauthenticated attackers can list all configured adapters (`GET`).
    *   **Denial of Service / Data Integrity:** Unauthenticated attackers can create arbitrary adapters (`POST`), potentially filling the database or injecting malicious configurations.
*   **Status:** **Fixed**

### 2. Remote Code Execution (RCE) Risk (Critical)
*   **Location:** `src/lib/adapters/database/postgres.ts` (and potentially `mysql.ts`, `mongodb.ts`)
*   **Issue:** The adapter uses `child_process.exec` and appends user-controlled input (`config.options`) directly into the shell command string.
*   **Impact:** An attacker with access to adapter configuration (e.g., via Vulnerability #1 or a compromised admin account) can inject arbitrary shell commands (e.g., `; rm -rf /`, reverse shells) which will be executed by the server.
*   **Status:** **Fixed** (Refactored to `execFile`)

### 3. Missing Global Middleware (Medium)
*   **Location:** Workspace Root
*   **Issue:** There is no `src/middleware.ts` file.
*   **Impact:** Authentication logic is decentralized. If a developer forgets to add a session check to a new route or page, it fails open (becomes public by default). This increases the risk of accidental exposure.
*   **Status:** **Fixed**

### 4. Public Uploads Isolation (Medium)
*   **Location:** `public/uploads/avatars`
*   **Issue:** User uploads are stored in the public directory and served directly by Next.js.
*   **Impact:** While file signature validation is in place (good), serving user content from the same domain poses a risk of XSS or malicious file execution if the validation is bypassed.
*   **Status:** Open

---

## Remediation Plan / Tasks

### Immediate Actions (High Priority)

- [x] **Secure Adapter API (`src/app/api/adapters/route.ts`)**
    - [x] Add `auth.api.getSession` check at the beginning of `GET` handler.
    - [x] Add `auth.api.getSession` check at the beginning of `POST` handler.
    - [x] Return `401 Unauthorized` if session is missing.

- [x] **Audit & Secure All Other API Routes**
    - [x] Check `src/app/api/jobs/`
    - [x] Check `src/app/api/history/`
    - [x] Check `src/app/api/storage/`
    - [x] Apply the same authentication checks as above.

- [x] **Fix RCE Vulnerabilities in Adapters**
    - [x] Refactor `PostgresAdapter` (`src/lib/adapters/database/postgres.ts`) to use `child_process.execFile` or strictly validate/sanitize `config.options`.
    - [x] Refactor `MysqlAdapter` (if applicable).
    - [x] Refactor `MongodbAdapter` (if applicable).
    - [x] **Constraint:** Ensure `config.options` only accepts safe flags or remove the ability to pass raw options entirely if possible.

### Structural Improvements (Medium Priority)

- [x] **Implement Global Middleware**
    - [x] Create `src/middleware.ts`.
    - [x] Configure `better-auth` middleware or manual session check to protect `/dashboard/*` and `/api/*` routes by default.
    - [x] Exclude public routes (e.g., `/`, `/api/auth/*`, `/login`).

- [x] **Review File Upload Storage**
    - [x] Consider moving uploads outside of `public/` to a private directory (e.g., `storage/uploads`).
    - [x] Create an API route `GET /api/avatar/[filename]` to serve these files with correct headers (`Content-Type`, `X-Content-Type-Options: nosniff`).

## Reporting New Issues
If you discover a new vulnerability, please add it to this document or create a new issue labeled `security`.
