"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { ReadingMediaController } from "@/lib/reading-media-controller";
import {
  bilibiliEmbedUrl,
  type BilibiliSource,
} from "@/lib/reading-video-sources";

export function BilibiliReadingPlayer({
  source,
  startSeconds,
  duration,
  title,
  onController,
  onTime,
}: {
  source: BilibiliSource;
  startSeconds: number;
  duration: number;
  title: string;
  onController(controller: ReadingMediaController | null): void;
  onTime(seconds: number, duration: number): void;
}) {
  const [playerStart, setPlayerStart] = useState(startSeconds);
  const timeRef = useRef(startSeconds);

  const controller = useMemo<ReadingMediaController>(
    () => ({
      currentTime: () => timeRef.current,
      duration: () => duration,
      seek: (seconds) => {
        const next = Math.min(
          duration || Number.POSITIVE_INFINITY,
          Math.max(0, seconds),
        );
        timeRef.current = next;
        setPlayerStart(next);
        onTime(next, duration);
      },
      // Bilibili's documented external player does not expose a public
      // play/pause JavaScript API. Native controls remain available inside it.
      play: () => undefined,
      pause: () => undefined,
      destroy: () => undefined,
    }),
    [duration, onTime],
  );

  useEffect(() => {
    onController(controller);
    onTime(timeRef.current, duration);
    return () => onController(null);
  }, [controller, duration, onController, onTime]);

  return (
    <iframe
      src={bilibiliEmbedUrl(source, playerStart)}
      title={title}
      className="aspect-video h-full w-full border-0 bg-black"
      allow="autoplay; fullscreen; picture-in-picture"
      allowFullScreen
      loading="eager"
      referrerPolicy="strict-origin-when-cross-origin"
    />
  );
}
