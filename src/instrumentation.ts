export async function register() {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
        console.log("Registering Application Instrumentation...");

        // 1. Validate environment variables before anything else
        const { validateEnvironment } = await import('@/lib/env-validation');
        validateEnvironment();

        // 2. Initialize scheduler (cron jobs)
        const { scheduler } = await import('@/lib/scheduler');
        await scheduler.init();

        // 3. Register graceful shutdown handlers
        const { registerShutdownHandlers } = await import('@/lib/shutdown');
        registerShutdownHandlers();
    }
}
