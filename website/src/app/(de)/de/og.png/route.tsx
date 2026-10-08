import { siteOgImage } from "@/components/pages/og-image";

// The social card at a fixed .png path, so the host sends it as an image. Rendered once during the static export.
export const dynamic = "force-static";

export function GET() {
  return siteOgImage("de");
}
