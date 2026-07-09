import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Nav } from "@/components/site/nav";
import { Footer } from "@/components/site/footer";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const TAGLINE =
  "Self-hosted database backup automation with encryption, compression, and smart retention.";

export const metadata: Metadata = {
  metadataBase: new URL("https://dbackup.app"),
  title: {
    default: "DBackup - Database Backup Automation",
    template: "%s | DBackup",
  },
  description: TAGLINE,
  icons: {
    icon: "/favicon/favicon-32x32.png",
    apple: "/favicon/favicon-256x256.png",
  },
  openGraph: {
    title: "DBackup - Database Backup Automation",
    description: TAGLINE,
    url: "https://dbackup.app",
    siteName: "DBackup",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "DBackup - Database Backup Automation",
    description: TAGLINE,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased flex min-h-screen flex-col`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <TooltipProvider>
            <Nav />
            <main className="flex-1">{children}</main>
            <Footer />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
