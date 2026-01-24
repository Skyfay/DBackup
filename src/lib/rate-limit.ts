import { RateLimiterMemory } from 'rate-limiter-flexible';

// Define rate limiters
// 5 attempts per minute per IP for sensitive inputs
export const authLimiter = new RateLimiterMemory({
    points: 5,
    duration: 60,
});

// 100 requests per minute per IP for general API
// NOTE: For a real production cluster, you would use Redis/Memcached store instead of Memory
export const apiLimiter = new RateLimiterMemory({
    points: 100,
    duration: 60,
});

// 20 requests per minute per IP for write operations (POST, PUT, DELETE)
// To prevent Audit Log Flooding and other spam attacks
export const mutationLimiter = new RateLimiterMemory({
    points: 20,
    duration: 60,
});
