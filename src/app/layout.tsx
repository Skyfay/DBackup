import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme/theme-provider";
import prisma from "@/lib/prisma";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  let instanceName: string | undefined;
  try {
    const setting = await prisma.systemSetting.findUnique({ where: { key: "general.instanceName" } });
    instanceName = setting?.value?.trim();
  } catch {
    // DB not available at build time.
  }
  return {
    title: instanceName ? `DBackup | ${instanceName}` : "DBackup",
    description: "Manage your database backups easily.",
    icons: {
      icon: [
        { url: '/logo.svg', type: 'image/svg+xml' },
      ],
      apple: '/logo.svg',
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // The font variables sit on <html> because Tailwind resolves the default font family on :root.
    // On <body> they were out of its reach and every page fell back to the system font.
    <html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="antialiased">
        <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
        >
            {children}
            <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
