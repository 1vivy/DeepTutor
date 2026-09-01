"use client";

import { useParams, useRouter } from "next/navigation";
import { useMemo } from "react";

export function firstRouteSessionId(value: string | string[] | undefined): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  const normalized = candidate?.trim() ?? "";
  return normalized || null;
}

export function shouldRevalidateCachedSession(input: {
  routeSessionId: string | null;
  selectedSessionId: string | null;
  hasCachedMessages: boolean;
  isStreaming: boolean;
}): boolean {
  return Boolean(
    input.routeSessionId &&
      input.hasCachedMessages &&
      !input.isStreaming &&
      input.routeSessionId === input.selectedSessionId,
  );
}

export function useChatRouteSession() {
  const params = useParams<{ sessionId?: string[] }>();
  const router = useRouter();
  const sessionId = useMemo(() => firstRouteSessionId(params.sessionId), [params.sessionId]);
  return { router, sessionId };
}
