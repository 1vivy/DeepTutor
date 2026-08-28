export interface ReadingMediaController {
  currentTime(): number;
  duration(): number;
  seek(seconds: number): void;
  play(): void;
  pause(): void;
  destroy(): void;
}

export interface YouTubePlayerLike {
  getCurrentTime(): number;
  getDuration(): number;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  playVideo(): void;
  pauseVideo(): void;
  destroy(): void;
}

export function youtubeReadingController(
  player: YouTubePlayerLike,
): ReadingMediaController {
  return {
    currentTime: () => Number(player.getCurrentTime()) || 0,
    duration: () => Number(player.getDuration()) || 0,
    seek: (seconds) => player.seekTo(Math.max(0, seconds), true),
    play: () => player.playVideo(),
    pause: () => player.pauseVideo(),
    destroy: () => player.destroy(),
  };
}

export function html5ReadingController(
  media: HTMLMediaElement,
): ReadingMediaController {
  return {
    currentTime: () => Number(media.currentTime) || 0,
    duration: () => Number(media.duration) || 0,
    seek: (seconds) => {
      media.currentTime = Math.max(0, seconds);
    },
    play: () => void media.play(),
    pause: () => media.pause(),
    destroy: () => media.pause(),
  };
}
