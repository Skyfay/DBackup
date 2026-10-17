/**
 * Centralized abort registry for running executions (backup & restore).
 * Allows cancellation of any running execution from the UI.
 */

const controllers = new Map<string, AbortController>();

/**
 * Register a new execution with an AbortController.
 * Returns the AbortController's signal for the caller to use. A second run of the same work, like
 * the provider's run of a customer's restore of a shared database, passes the controller of the
 * first, so cancelling either stops both.
 */
export function registerExecution(executionId: string, controller = new AbortController()): AbortController {
    controllers.set(executionId, controller);
    return controller;
}

/**
 * Unregister an execution (called when execution finishes).
 */
export function unregisterExecution(executionId: string): void {
    controllers.delete(executionId);
}

/**
 * Abort a running execution by ID.
 * Returns true if the execution was found and signalled.
 */
export function abortExecution(executionId: string): boolean {
    const controller = controllers.get(executionId);
    if (controller) {
        controller.abort();
        return true;
    }
    return false;
}

/**
 * Check if an execution is currently running in this process.
 */
export function isExecutionRunning(executionId: string): boolean {
    return controllers.has(executionId);
}
