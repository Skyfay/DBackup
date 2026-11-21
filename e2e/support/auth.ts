/**
 * The steps of the sign-in tests: a person of their own per test, made by the platform admin in the
 * home tenant, signing in and out through the login page and the menu of the sidebar, the code of
 * an authenticator app worked out from its key, and the virtual authenticator of Chromium for the
 * passkeys. The shared admin of the setup never gets a second factor or a passkey.
 *
 * better-auth limits the sign-in and the codes of the second factor on its own, apart from the
 * limits of Settings: three requests to a path from one address, each within ten seconds of the
 * one before. Every such request of these tests goes through `paced`, which waits for the quiet ten
 * seconds a fourth one needs, rather than lifting the limit.
 */

import { createHmac } from "crypto";
import { expect, type Browser, type BrowserContext, type CDPSession, type Page } from "@playwright/test";
import { unique } from "./app";
import { ADMIN } from "./environment";
import { HOME, PASSWORD, contextOptions, newPerson, signIn, switchTo } from "./tenants";

/** The rule of better-auth for `/sign-in/*` and `/two-factor/*`: at most 3 requests, each within 10 seconds of the last. */
const LIMIT = { max: 3, windowMs: 10_000 };

/** What these tests sent to each limited path. Unknown at the start, the setup and other specs sign in too, so taken as full. */
const sent = new Map<string, { count: number; last: number }>();
const loadedAt = Date.now();

/** Waits until better-auth takes one more request to `path` from this machine, and counts it. */
export async function paced(path: "/sign-in/email" | "/sign-in/sso" | "/two-factor/verify-totp" | "/two-factor/verify-backup-code"): Promise<void> {
    const bucket = sent.get(path) ?? { count: LIMIT.max, last: loadedAt };
    if (Date.now() - bucket.last > LIMIT.windowMs) bucket.count = 0;
    if (bucket.count >= LIMIT.max) {
        await new Promise((resolve) => setTimeout(resolve, bucket.last + LIMIT.windowMs + 1_000 - Date.now()));
        bucket.count = 0;
    }
    bucket.count += 1;
    bucket.last = Date.now();
    sent.set(path, bucket);
}

/** Waits until every limited path is quiet again, so the specs after these sign in without counting theirs. */
export async function quietLimits(): Promise<void> {
    const last = Math.max(0, ...[...sent.values()].map((bucket) => bucket.last));
    const wait = last + LIMIT.windowMs + 1_000 - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}

/** Signs in with the password through the login page and waits for the dashboard, like `signIn` of tenants.ts, paced. */
export async function signInPaced(page: Page, email: string, password: string): Promise<void> {
    await paced("/sign-in/email");
    await signIn(page, email, password);
}

export interface Person {
    name: string;
    email: string;
    password: string;
}

/**
 * A new person in the home tenant with its Admin group, made by the platform admin in a browser of
 * its own. The email is a new one unless the test names it, like that of a person of an identity provider.
 */
export async function makePerson(browser: Browser, name: string, email = `${unique()}@auth.e2e.dbackup.test`): Promise<Person> {
    const person = { name, email, password: PASSWORD };
    const admin = await browser.newContext(contextOptions);
    try {
        const page = await admin.newPage();
        await signInPaced(page, ADMIN.email, ADMIN.password);
        // With a second tenant from another spec the platform admin starts in All tenants.
        if (await page.getByRole("button", { name: /Switch the tenant$/ }).isVisible()) await switchTo(page, HOME);
        await newPerson(page, person, HOME);
    } finally {
        await admin.close();
    }
    return person;
}

/** Types the email and the password on the login page and presses Sign in, without waiting for where it leads. */
export async function submitPassword(page: Page, email: string, password: string): Promise<void> {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await paced("/sign-in/email");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

/** Whether the browser of the page holds a session, asked of better-auth with its cookies. */
export async function hasSession(page: Page): Promise<boolean> {
    const response = await page.request.get("/api/auth/get-session");
    const body = (await response.text()).trim();
    return body !== "" && body !== "null";
}

/** Logs out through the menu of the person at the foot of the sidebar. */
export async function signOut(page: Page, person: Person): Promise<void> {
    await page.getByRole("button", { name: new RegExp(person.name) }).click();
    await page.getByRole("menuitem", { name: "Log out", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
}

/** Opens the Security part of the own profile. */
export async function openSecurity(page: Page): Promise<void> {
    await page.goto("/dashboard/profile?part=security");
    await expect(page.getByText("Authenticator app", { exact: true })).toBeVisible();
}

/** The bytes of a key in Base32 (RFC 4648), the way an authenticator app reads the key of its QR code. */
function fromBase32(text: string): Buffer {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let bits = "";
    for (const char of text.replace(/[\s=]/g, "").toUpperCase()) {
        const value = alphabet.indexOf(char);
        if (value < 0) throw new Error(`${char} is no Base32 character`);
        bits += value.toString(2).padStart(5, "0");
    }
    const bytes: number[] = [];
    for (let at = 0; at + 8 <= bits.length; at += 8) bytes.push(parseInt(bits.slice(at, at + 8), 2));
    return Buffer.from(bytes);
}

/** The code an authenticator app shows for a key, after RFC 6238: SHA-1, 30 seconds, 6 digits. */
export function totp(key: string, at = Date.now()): string {
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
    const digest = createHmac("sha1", fromBase32(key)).update(counter).digest();
    const offset = digest[digest.length - 1] & 0x0f;
    const value = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
    return String(value).padStart(6, "0");
}

/** A code of six digits that none of the codes the server accepts right now matches, the one before and after included. */
export function wrongCode(key: string): string {
    const near = new Set([-1, 0, 1].map((step) => totp(key, Date.now() + step * 30_000)));
    for (let value = 0; ; value++) {
        const code = String(value).padStart(6, "0");
        if (!near.has(code)) return code;
    }
}

export interface VirtualAuthenticator {
    cdp: CDPSession;
    authenticatorId: string;
}

/**
 * A passkey device built into the page, through the virtual authenticator of Chromium: it keeps
 * passkeys of its own (resident keys), verifies the person and answers every prompt by itself.
 */
export async function addVirtualAuthenticator(context: BrowserContext, page: Page): Promise<VirtualAuthenticator> {
    const cdp = await context.newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
        options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
    });
    return { cdp, authenticatorId };
}

/** The passkeys the virtual authenticator holds. */
export async function credentialsOf(device: VirtualAuthenticator): Promise<{ isResidentCredential: boolean; rpId?: string }[]> {
    const { credentials } = await device.cdp.send("WebAuthn.getCredentials", { authenticatorId: device.authenticatorId });
    return credentials;
}
