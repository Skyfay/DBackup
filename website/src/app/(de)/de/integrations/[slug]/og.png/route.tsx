import { databaseOgImage } from "@/components/pages/og-image";
import { databasePageParams } from "@/components/pages/database-page";

// The card of a database page at a fixed .png path, so the host sends it as an
// image. Rendered once per page during the static export.
export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return databasePageParams();
}

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return databaseOgImage("de", (await params).slug);
}
