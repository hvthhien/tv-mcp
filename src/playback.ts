/**
 * Playback verification over the CDP plane — the primary Xcontrol use case:
 * assert that VOD content or an advertisement is actually playing on the
 * panel.
 *
 * Metrics-first by design: on TVs, DRM-protected video is composited in a
 * hardware plane OUTSIDE Chromium, so CDP screenshots show black where video
 * plays. currentTime + decoded-frame counters are the ground truth;
 * screenshots are supporting evidence for the UI layer only
 * (see docs/KNOWLEDGE.md, "webOS platform internals").
 */

export interface PlaybackSample {
  t: number;
  paused: boolean;
  ended: boolean;
  readyState: number;
  networkState: number;
  err: { code: number; message: string } | null;
  q: { dropped: number; total: number } | null;
  w: number;
  h: number;
  muted: boolean;
  src: string;
}

export interface PlaybackSnapshot {
  count?: number;
  a?: PlaybackSample;
  b?: PlaybackSample;
  verdict?: "no-video";
}

export type PlaybackVerdict =
  | "playing"
  | "stalled"
  | "decoding-stalled"
  | "paused"
  | "ended"
  | "error"
  | "no-video";

export interface PlaybackJudgement {
  verdict: PlaybackVerdict;
  reason: string;
  timeAdvanced?: number;
  framesAdvanced?: number;
  droppedRatio?: number;
}

/**
 * Builds the expression evaluated in the app context. Samples the video
 * element twice, `sampleMs` apart, entirely inside the page so a single
 * CDP round-trip returns both samples.
 */
export function buildSamplerExpression(selector: string, sampleMs: number): string {
  return `(async () => {
  const els = [...document.querySelectorAll(${JSON.stringify(selector)})];
  if (els.length === 0) return { verdict: "no-video" };
  const v = els.find((e) => !e.paused && !e.ended) ?? els[0];
  const snap = () => ({
    t: v.currentTime,
    paused: v.paused,
    ended: v.ended,
    readyState: v.readyState,
    networkState: v.networkState,
    err: v.error ? { code: v.error.code, message: v.error.message || "" } : null,
    q: typeof v.getVideoPlaybackQuality === "function"
      ? (({ droppedVideoFrames: dropped, totalVideoFrames: total }) => ({ dropped, total }))(v.getVideoPlaybackQuality())
      : null,
    w: v.videoWidth, h: v.videoHeight, muted: v.muted, src: v.currentSrc || "",
  });
  const a = snap();
  await new Promise((r) => setTimeout(r, ${sampleMs}));
  const b = snap();
  return { count: els.length, a, b };
})()`;
}

const MEDIA_ERR: Record<number, string> = {
  1: "MEDIA_ERR_ABORTED",
  2: "MEDIA_ERR_NETWORK",
  3: "MEDIA_ERR_DECODE",
  4: "MEDIA_ERR_SRC_NOT_SUPPORTED",
};

/** Pure verdict logic over the two samples. */
export function judgePlayback(snapshot: PlaybackSnapshot, sampleMs: number): PlaybackJudgement {
  if (snapshot.verdict === "no-video" || !snapshot.a || !snapshot.b) {
    return { verdict: "no-video", reason: "No <video> element matched the selector." };
  }
  const { a, b } = snapshot;

  if (b.err) {
    return {
      verdict: "error",
      reason: `MediaError ${b.err.code} (${MEDIA_ERR[b.err.code] ?? "unknown"})${b.err.message ? `: ${b.err.message}` : ""}`,
    };
  }
  if (b.ended) {
    return { verdict: "ended", reason: `Playback ended at ${b.t.toFixed(1)}s.` };
  }
  if (b.paused) {
    return { verdict: "paused", reason: `Element is paused at ${b.t.toFixed(1)}s.` };
  }

  const timeAdvanced = b.t - a.t;
  const framesAdvanced = a.q && b.q ? b.q.total - a.q.total : undefined;
  const droppedRatio =
    b.q && b.q.total > 0 ? (b.q.dropped - (a.q?.dropped ?? 0)) / Math.max(1, b.q.total - (a.q?.total ?? 0)) : undefined;

  // The clock should advance roughly with wall time; accept half to allow
  // for TV-side timer throttling and playbackRate < 1.
  const expected = sampleMs / 1000;
  const clockMoving = timeAdvanced > expected * 0.5;

  if (clockMoving && framesAdvanced !== undefined && framesAdvanced === 0) {
    return {
      verdict: "decoding-stalled",
      reason: `currentTime advanced ${timeAdvanced.toFixed(2)}s but zero new video frames were decoded — audio may be playing over a frozen/black picture.`,
      timeAdvanced,
      framesAdvanced,
      droppedRatio,
    };
  }
  if (clockMoving) {
    return {
      verdict: "playing",
      reason:
        `currentTime advanced ${timeAdvanced.toFixed(2)}s over ${expected.toFixed(1)}s` +
        (framesAdvanced !== undefined ? `, ${framesAdvanced} new frames decoded` : "") +
        (droppedRatio !== undefined && droppedRatio > 0.1
          ? ` — WARNING: ${(droppedRatio * 100).toFixed(0)}% of new frames dropped`
          : "") +
        ".",
      timeAdvanced,
      framesAdvanced,
      droppedRatio,
    };
  }
  return {
    verdict: "stalled",
    reason:
      `currentTime did not advance (${timeAdvanced.toFixed(3)}s over ${expected.toFixed(1)}s), element not paused` +
      (b.readyState < 3 ? ` — readyState ${b.readyState} (buffering/no data)` : ` — readyState ${b.readyState} despite claiming enough data`) +
      (b.networkState === 3 ? ", networkState NO_SOURCE" : "") +
      ".",
    timeAdvanced,
    framesAdvanced,
    droppedRatio,
  };
}
