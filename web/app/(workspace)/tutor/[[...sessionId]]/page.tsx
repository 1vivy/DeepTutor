"use client";

/**
 * The Tutor workspace's chat route.
 *
 * Deliberately the *same* page component as ``/home``: both workspaces run one
 * chat engine, one WebSocket protocol and one turn runtime, so forking the
 * page here would mean maintaining two 2000-line twins that drift. What
 * differs between the modes is expressed as data — the sidebar's nav table,
 * the composer's capability list, and the empty state (Tutor renders the
 * Today dashboard where General renders a greeting) — all resolved from
 * ``useAppShell().mode``, which this URL asserts as "tutor".
 *
 * The optional catch-all mirrors ``/home``'s so ``useParams().sessionId``
 * resolves identically in both.
 */
export { default } from "@/app/(workspace)/home/[[...sessionId]]/page";
