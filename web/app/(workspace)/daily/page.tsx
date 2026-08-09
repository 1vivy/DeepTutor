"use client";

/**
 * ``/daily`` — the learner's activity page.
 *
 * Lives outside the chat route on purpose. As the Tutor route's empty state it
 * shared the viewport with a floating composer, so anything past the second
 * section slid underneath it; here it owns its own scroll and can show a full
 * week.
 *
 * Mode-agnostic like the other non-chat routes (Learning Space, Book,
 * Knowledge Center): it appears in the Tutor sidebar and starts Tutor
 * conversations, but visiting it never changes which workspace you are in.
 */

import DailyDashboard from "@/components/daily/DailyDashboard";

export default function DailyPage() {
  return <DailyDashboard />;
}
