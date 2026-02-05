/**
 * ServiceResult Type for DBackup
 *
 * Provides a standardized result type for all service operations.
 * Forces explicit handling of success and failure cases at compile time.
 *
 * @example
 * ```typescript
 * import { ServiceResult, success, failure } from "@/lib/types/service-result";
 *
 * async function createJob(data: JobInput): Promise<ServiceResult<Job>> {
 *   try {
 *     const job = await prisma.job.create({ data });
 *     return success(job);
 *   } catch (error) {
 *     return failureFromError(error);
 *   }
 * }
 *
 * // Usage
 * const result = await createJob(input);
 * if (result.success) {
 *   console.log(result.data); // TypeScript knows data exists
 * } else {
 *   console.log(result.error); // TypeScript knows error exists
 * }
 * ```
 */

import { DBackupError } from "@/lib/errors";

// ============================================================================
// Types
// ============================================================================

/**
 * Standardized result type for all service operations.
 * Discriminated union ensures type-safe handling of success/failure.
 */
export type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string; details?: unknown };

/**
 * Async version of ServiceResult for Promise returns.
 */
export type AsyncServiceResult<T> = Promise<ServiceResult<T>>;

/**
 * Result type for void operations (no data returned on success).
 */
export type VoidServiceResult = ServiceResult<void>;

/**
 * Result type for operations returning a list with optional pagination.
 */
export type ListServiceResult<T> = ServiceResult<{
  items: T[];
  total?: number;
  page?: number;
  pageSize?: number;
}>;

// ============================================================================
// Success Constructors
// ============================================================================

/**
 * Creates a successful service result.
 *
 * @example
 * ```typescript
 * return success(createdJob);
 * return success({ id: "123", name: "Backup" });
 * ```
 */
export function success<T>(data: T): ServiceResult<T> {
  return { success: true, data };
}

/**
 * Creates a successful void result (for operations with no return data).
 *
 * @example
 * ```typescript
 * await prisma.job.delete({ where: { id } });
 * return ok();
 * ```
 */
export function ok(): VoidServiceResult {
  return { success: true, data: undefined };
}

// ============================================================================
// Failure Constructors
// ============================================================================

/**
 * Creates a failed service result from a string message.
 *
 * @example
 * ```typescript
 * return failure("Job not found");
 * return failure("Invalid configuration", "VALIDATION_ERROR");
 * ```
 */
export function failure(
  error: string,
  code?: string,
  details?: unknown
): ServiceResult<never> {
  return { success: false, error, code, details };
}

/**
 * Creates a failed service result from an Error object.
 * Automatically extracts code and context from DBackupError.
 *
 * @example
 * ```typescript
 * try {
 *   await riskyOperation();
 * } catch (error) {
 *   return failureFromError(error);
 * }
 * ```
 */
export function failureFromError(error: unknown): ServiceResult<never> {
  if (error instanceof DBackupError) {
    return {
      success: false,
      error: error.message,
      code: error.code,
      details: error.context,
    };
  }

  if (error instanceof Error) {
    return { success: false, error: error.message };
  }

  if (typeof error === "string") {
    return { success: false, error };
  }

  return { success: false, error: "An unexpected error occurred" };
}

/**
 * Creates a "not found" failure result.
 * Shorthand for common 404-style errors.
 *
 * @example
 * ```typescript
 * const job = await prisma.job.findUnique({ where: { id } });
 * if (!job) return notFound("Job", id);
 * ```
 */
export function notFound(
  resource: string,
  identifier?: string
): ServiceResult<never> {
  const message = identifier
    ? `${resource} not found: ${identifier}`
    : `${resource} not found`;
  return { success: false, error: message, code: "NOT_FOUND" };
}

/**
 * Creates a validation failure result.
 *
 * @example
 * ```typescript
 * const result = schema.safeParse(input);
 * if (!result.success) {
 *   return validationFailed("Invalid input", result.error.flatten());
 * }
 * ```
 */
export function validationFailed(
  message: string,
  details?: unknown
): ServiceResult<never> {
  return { success: false, error: message, code: "VALIDATION_ERROR", details };
}

/**
 * Creates a permission denied failure result.
 *
 * @example
 * ```typescript
 * if (!hasPermission(user, "backup:create")) {
 *   return permissionDenied("backup:create");
 * }
 * ```
 */
export function permissionDenied(permission?: string): ServiceResult<never> {
  const message = permission
    ? `Permission denied: ${permission} required`
    : "Permission denied";
  return { success: false, error: message, code: "PERMISSION_DENIED" };
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard to check if result is successful.
 * Narrows the type to access `data` property.
 *
 * @example
 * ```typescript
 * const result = await jobService.create(input);
 * if (isSuccess(result)) {
 *   // result.data is available and typed
 *   return result.data;
 * }
 * ```
 */
export function isSuccess<T>(
  result: ServiceResult<T>
): result is { success: true; data: T } {
  return result.success === true;
}

/**
 * Type guard to check if result is a failure.
 * Narrows the type to access `error` property.
 *
 * @example
 * ```typescript
 * const result = await jobService.create(input);
 * if (isFailure(result)) {
 *   // result.error is available
 *   logger.error("Failed", { error: result.error });
 * }
 * ```
 */
export function isFailure<T>(
  result: ServiceResult<T>
): result is { success: false; error: string; code?: string; details?: unknown } {
  return result.success === false;
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Unwraps a successful result or throws on failure.
 * Use sparingly - prefer explicit success/failure handling.
 *
 * @example
 * ```typescript
 * // Only use when failure is truly exceptional
 * const job = unwrapOrThrow(await jobService.getById(id));
 * ```
 */
export function unwrapOrThrow<T>(result: ServiceResult<T>): T {
  if (result.success) {
    return result.data;
  }
  throw new Error(result.error);
}

/**
 * Unwraps a successful result or returns a default value.
 *
 * @example
 * ```typescript
 * const jobs = unwrapOr(await jobService.list(), []);
 * ```
 */
export function unwrapOr<T>(result: ServiceResult<T>, defaultValue: T): T {
  if (result.success) {
    return result.data;
  }
  return defaultValue;
}

/**
 * Maps a successful result to a new value.
 * Failure results pass through unchanged.
 *
 * @example
 * ```typescript
 * const result = await jobService.getById(id);
 * const nameResult = map(result, job => job.name);
 * ```
 */
export function map<T, U>(
  result: ServiceResult<T>,
  fn: (data: T) => U
): ServiceResult<U> {
  if (result.success) {
    return success(fn(result.data));
  }
  return result;
}

/**
 * Chains service results (flatMap).
 * Returns the result of fn if successful, otherwise passes through failure.
 *
 * @example
 * ```typescript
 * const result = await chain(
 *   await jobService.getById(id),
 *   job => backupService.run(job)
 * );
 * ```
 */
export function chain<T, U>(
  result: ServiceResult<T>,
  fn: (data: T) => ServiceResult<U>
): ServiceResult<U> {
  if (result.success) {
    return fn(result.data);
  }
  return result;
}

/**
 * Async version of chain for Promise-returning functions.
 *
 * @example
 * ```typescript
 * const result = await chainAsync(
 *   await jobService.getById(id),
 *   job => backupService.runAsync(job)
 * );
 * ```
 */
export async function chainAsync<T, U>(
  result: ServiceResult<T>,
  fn: (data: T) => Promise<ServiceResult<U>>
): Promise<ServiceResult<U>> {
  if (result.success) {
    return fn(result.data);
  }
  return result;
}

/**
 * Converts a ServiceResult to an API response format.
 * Useful in API routes for consistent responses.
 *
 * @example
 * ```typescript
 * // In API route
 * const result = await jobService.create(input);
 * return NextResponse.json(toApiResponse(result));
 * ```
 */
export function toApiResponse<T>(
  result: ServiceResult<T>
): { success: boolean; data?: T; error?: string; code?: string } {
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error, code: result.code };
}
