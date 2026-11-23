/**
 * The pages load only DBackup's own scripts, styles, images and fonts. Next.js writes its bootstrap
 * as inline scripts, so `'unsafe-inline'` stays, and only the dev server needs `'unsafe-eval'` for its
 * fast refresh. No plugin objects, no `<base>` pointing elsewhere, no form posting to another site and
 * no other site framing a page.
 */
export const CONTENT_SECURITY_POLICY = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
].join("; ");
