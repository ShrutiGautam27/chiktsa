import { useEffect } from "react";
import { BRAND } from "@/lib/brand";

/** Sets a descriptive document title per page (accessibility + SEO). */
export function usePageTitle(title?: string) {
  useEffect(() => {
    document.title = title ? `${title} · ${BRAND.full}` : `${BRAND.full} — Connected family care for elders`;
  }, [title]);
}
