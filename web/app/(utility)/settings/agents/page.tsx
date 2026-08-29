"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Former sub-hub. The settings navigator lists these pages directly now, so a
 * grid that only repeated those links was a click with nothing behind it.
 * Kept as a redirect because the route is bookmarkable and was linked from
 * the old breadcrumb.
 */
export default function RedirectToFirstLeaf() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/settings/agents/claude-code");
  }, [router]);
  return null;
}
