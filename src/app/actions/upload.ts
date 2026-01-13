"use server"

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { writeFile } from "fs/promises";
import path from "path";
import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";

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

    if (!file.type.startsWith("image/")) {
        return { success: false, error: "Invalid file type" };
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const filename = `${session.user.id}-${Date.now()}${path.extname(file.name)}`;
    
    // Ensure the uploads directory matches where we created it (public/uploads/avatars)
    const uploadDir = path.join(process.cwd(), "public", "uploads", "avatars");
    const filepath = path.join(uploadDir, filename);

    try {
        await writeFile(filepath, buffer);
        
        const publicUrl = `/uploads/avatars/${filename}`;

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
