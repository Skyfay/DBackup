/**
 * The picture of the login page, picked under Settings, Sign-in instead of the logos of the
 * adapters. Everyone who opens the login page sees it, so the service checks what it keeps: a PNG,
 * JPEG or WebP read from its first bytes, never an SVG, which could carry a script, and at most
 * LOGIN_IMAGE_MAX_BYTES. It lives in the database, so a configuration backup brings it back.
 */

import prisma from "@/lib/prisma";
import { ValidationError } from "@/lib/logging/errors";

export const LOGIN_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** The setting that picks what the left of the login page shows. */
export const LOGIN_LOOK_KEY = "signin.loginLook";

export type LoginLook = "logos" | "image";

export type LoginImageType = "image/png" | "image/jpeg" | "image/webp";

export interface LoginImageInfo {
    fileName: string;
    mimeType: LoginImageType;
    size: number;
    updatedAt: string;
}

const ROW_ID = "login";

function ascii(bytes: Uint8Array, from: number, to: number): string {
    return String.fromCharCode(...bytes.subarray(from, to));
}

/** The type of an image by its first bytes, null for anything else, an SVG included. */
export function imageTypeOf(bytes: Uint8Array): LoginImageType | null {
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (bytes.length >= png.length && png.every((value, index) => bytes[index] === value)) return "image/png";
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
    if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "image/webp";
    return null;
}

/** The name the settings show, without a path and without characters a header would choke on. */
function cleanName(fileName: string): string {
    const base = fileName.split(/[\\/]/).pop() ?? "";
    const printable = base.replace(/[^\x20-\x7e]/g, "").trim();
    return (printable || "login-image").slice(0, 120);
}

function infoOf(row: { fileName: string; mimeType: string; size: number; updatedAt: Date }): LoginImageInfo {
    return { fileName: row.fileName, mimeType: row.mimeType as LoginImageType, size: row.size, updatedAt: row.updatedAt.toISOString() };
}

export function isLoginLook(value: unknown): value is LoginLook {
    return value === "logos" || value === "image";
}

/** The stored picture without its bytes, for the settings. */
export async function getLoginImageInfo(): Promise<LoginImageInfo | null> {
    const row = await prisma.loginImage.findUnique({ where: { id: ROW_ID }, select: { fileName: true, mimeType: true, size: true, updatedAt: true } });
    return row ? infoOf(row) : null;
}

/** The stored picture with its bytes, whether the login page shows it or not, for the preview in the settings. */
export async function readLoginImage(): Promise<{ data: Uint8Array; mimeType: LoginImageType; updatedAt: Date } | null> {
    const row = await prisma.loginImage.findUnique({ where: { id: ROW_ID }, select: { data: true, mimeType: true, updatedAt: true } });
    return row ? { data: new Uint8Array(row.data), mimeType: row.mimeType as LoginImageType, updatedAt: row.updatedAt } : null;
}

async function storedLook(): Promise<LoginLook> {
    const row = await prisma.systemSetting.findUnique({ where: { key: LOGIN_LOOK_KEY }, select: { value: true } });
    return row?.value === "image" ? "image" : "logos";
}

/** The picture only while Your own image is picked, for the public route of the login page. */
export async function readPublicLoginImage() {
    return (await storedLook()) === "image" ? readLoginImage() : null;
}

/**
 * What the left of the login page shows: the picture with a version that changes with it, so a
 * browser never keeps an old one, or the logos while no picture is picked or stored.
 */
export async function getLoginPicture(): Promise<{ src: string } | null> {
    if ((await storedLook()) !== "image") return null;
    const info = await getLoginImageInfo();
    return info ? { src: `/api/login-image?v=${new Date(info.updatedAt).getTime()}` } : null;
}

/** Keeps a new picture in place of the one before. Throws a ValidationError for a file it refuses. */
export async function saveLoginImage(fileName: string, bytes: Uint8Array): Promise<LoginImageInfo> {
    if (bytes.length === 0) throw new ValidationError("The file is empty.", { field: "loginImage" });
    if (bytes.length > LOGIN_IMAGE_MAX_BYTES) throw new ValidationError("The picture is larger than 5 MB.", { field: "loginImage" });
    const mimeType = imageTypeOf(bytes);
    if (!mimeType) throw new ValidationError("Only a PNG, JPG or WebP picture works here.", { field: "loginImage" });

    const fields = { fileName: cleanName(fileName), mimeType, size: bytes.length, data: Buffer.from(bytes) };
    const row = await prisma.loginImage.upsert({
        where: { id: ROW_ID },
        create: { id: ROW_ID, ...fields },
        update: fields,
        select: { fileName: true, mimeType: true, size: true, updatedAt: true },
    });
    return infoOf(row);
}

/** Removes the picture, and the login page shows the logos again. */
export async function removeLoginImage(): Promise<void> {
    await prisma.$transaction([
        prisma.loginImage.deleteMany({}),
        prisma.systemSetting.upsert({
            where: { key: LOGIN_LOOK_KEY },
            update: { value: "logos" },
            create: { key: LOGIN_LOOK_KEY, value: "logos" },
        }),
    ]);
}
