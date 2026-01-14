"use server"

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { writeFile, unlink } from "fs/promises";
import path from "path";
import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";

// Helper function to check magic numbers (file signatures)
async function validateImageSignature(file: File): Promise<boolean> {
    const buffer = await file.slice(0, 12).arrayBuffer();
    const arr = new Uint8Array(buffer);

    // JPEG: FF D8 FF
    if (arr[0] === 0xFF && arr[1] === 0xD8 && arr[2] === 0xFF) return true;

    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (arr[0] === 0x89 && arr[1] === 0x50 && arr[2] === 0x4E && arr[3] === 0x47 &&
        arr[4] === 0x0D && arr[5] === 0x0A && arr[6] === 0x1A && arr[7] === 0x0A) return true;

    // GIF: 47 49 46 38 (GIF8)
    if (arr[0] === 0x47 && arr[1] === 0x49 && arr[2] === 0x46 && arr[3] === 0x38) return true;

    // WEBP: RIFF....WEBP
    if (arr[0] === 0x52 && arr[1] === 0x49 && arr[2] === 0x46 && arr[3] === 0x46 &&
        arr[8] === 0x57 && arr[9] === 0x45 && arr[10] === 0x42 && arr[11] === 0x50) return true;

    return false;
}

// Helper function to delete old avatar file
async function deleteOldAvatar(userImage: string | null) {
    // Old format: /uploads/avatars/filename
    // New format: /api/avatar/filename
    if (!userImage) return;

    let filename: string;
    if (userImage.startsWith('/uploads/avatars/')) {
        filename = path.basename(userImage);
    } else if (userImage.startsWith('/api/avatar/')) {
        filename = path.basename(userImage);
    } else {
        return;
    }

    try {
        // Try deleting from new location first
        let filepath = path.join(process.cwd(), "storage", "avatars", filename);

        // If not found, try old location (migration support)
        try {
            await unlink(filepath);
        } catch {
             filepath = path.join(process.cwd(), "public", "uploads", "avatars", filename);
             await unlink(filepath);
        }
    } catch (error) {
        console.error("Failed to delete old avatar file:", error);
        // Continue execution even if file deletion fails
    }
}

export async function uploadAvatar(formData: FormData) {
    const headersList = await headers();
    const session = await auth.api.getSession({
        headers: headersList
    });

    if (!session) {
        return { success: false, error: "Unauthorized" };
    }

    const file = formData.get("file") as File;
    if (!file) {
        return { success: false, error: "No file uploaded" };
    }

    // Validate request body
    if (file.size > 5 * 1024 * 1024) { // 5MB limit
        return { success: false, error: "File too large (max 5MB)" };
    }

    const isValidImage = await validateImageSignature(file);
    if (!isValidImage) {
        return { success: false, error: "Invalid file type (Must be JPEG, PNG, GIF, or WEBP)" };
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const filename = `${session.user.id}-${Date.now()}${path.extname(file.name)}`;

    // Save to private storage
    const uploadDir = path.join(process.cwd(), "storage", "avatars");
    // Ensure dir exists
    const fs = require('fs');
    if (!fs.existsSync(uploadDir)){
        fs.mkdirSync(uploadDir, { recursive: true });
    }

    const filepath = path.join(uploadDir, filename);

    try {
        // Delete old avatar if it exists
        const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { image: true } });
        if (user?.image) {
            await deleteOldAvatar(user.image);
        }

        await writeFile(filepath, buffer);

        const publicUrl = `/api/avatar/${filename}`;

        await prisma.user.update({
            where: { id: session.user.id },
            data: { image: publicUrl }
        });

        revalidatePath("/dashboard/settings");
        revalidatePath("/dashboard"); // For navbar/sidebar avatar

        return { success: true, url: publicUrl };
    } catch (error) {
        console.error("Upload error:", error);
        return { success: false, error: "Failed to save file" };
    }
}

export async function removeAvatar() {
    const headersList = await headers();
    const session = await auth.api.getSession({
        headers: headersList
    });

    if (!session) {
        return { success: false, error: "Unauthorized" };
    }

    try {
        // Fetch user to get the current image path
        const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { image: true } });

        if (user?.image) {
             await deleteOldAvatar(user.image);
        }

        await prisma.user.update({
            where: { id: session.user.id },
            data: { image: null }
        });

        revalidatePath("/dashboard/settings");
        revalidatePath("/dashboard");

        return { success: true };
    } catch (error) {
        console.error("Remove avatar error:", error);
        return { success: false, error: "Failed to remove avatar" };
    }
}
