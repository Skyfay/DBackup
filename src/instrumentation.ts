export async function register() {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
        console.log("Registering Application Instrumentation...");

        // 1. Validate environment variables before anything else
        const { validateEnvironment } = await import('@/lib/server/env-validation');
        validateEnvironment();

        // 2. Load rate limit settings from DB
        const { reloadRateLimits } = await import('@/lib/rate-limit/server');
        await reloadRateLimits();

        // 3. Recover stale executions from previous crash/hard-kill
        const { recoverStaleExecutions } = await import('@/lib/execution/recovery');
        await recoverStaleExecutions();

        // 4. Move the pictures of the people that earlier versions kept as files into the database
        const { importAvatarFiles } = await import('@/services/user/avatar-import');
        await importAvatarFiles();

        // 5. Initialize scheduler (cron jobs)
        const { scheduler } = await import('@/lib/server/scheduler');
        await scheduler.init();

        // 6. Validate credential profile assignments (flags adapters OFFLINE if missing)
        //    and the OIDC auto-redirect target (logs an error if it resolves to nothing)
        const { validateAdapterCredentials, validateOidcAutoRedirect } = await import('@/lib/server/startup-checks');
        await validateAdapterCredentials();
        await validateOidcAutoRedirect();

        // 7. Register graceful shutdown handlers
        const { registerShutdownHandlers } = await import('@/lib/server/shutdown');
        registerShutdownHandlers();
    }
}
