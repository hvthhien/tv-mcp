import { describe, expect, it } from "vitest";
import { buildSamplerExpression, judgePlayback } from "./playback.js";
import type { PlaybackSample } from "./playback.js";

const sample = (over: Partial<PlaybackSample> = {}): PlaybackSample => ({
  t: 10,
  paused: false,
  ended: false,
  readyState: 4,
  networkState: 2,
  err: null,
  q: { dropped: 0, total: 300 },
  w: 1920,
  h: 1080,
  muted: false,
  src: "https://vod.example/movie.m3u8",
  ...over,
});

describe("judgePlayback", () => {
  it("no-video when nothing matched", () => {
    expect(judgePlayback({ verdict: "no-video" }, 1500).verdict).toBe("no-video");
  });

  it("playing when clock and frames advance", () => {
    const j = judgePlayback(
      { count: 1, a: sample(), b: sample({ t: 11.4, q: { dropped: 0, total: 336 } }) },
      1500,
    );
    expect(j.verdict).toBe("playing");
    expect(j.framesAdvanced).toBe(36);
  });

  it("stalled when clock frozen and not paused", () => {
    const j = judgePlayback(
      { count: 1, a: sample(), b: sample({ t: 10.01, readyState: 2 }) },
      1500,
    );
    expect(j.verdict).toBe("stalled");
    expect(j.reason).toContain("readyState 2");
  });

  it("decoding-stalled when clock advances but no new frames", () => {
    const j = judgePlayback(
      { count: 1, a: sample(), b: sample({ t: 11.4, q: { dropped: 0, total: 300 } }) },
      1500,
    );
    expect(j.verdict).toBe("decoding-stalled");
  });

  it("error wins over everything", () => {
    const j = judgePlayback(
      { count: 1, a: sample(), b: sample({ err: { code: 3, message: "decode fail" } }) },
      1500,
    );
    expect(j.verdict).toBe("error");
    expect(j.reason).toContain("MEDIA_ERR_DECODE");
  });

  it("paused and ended verdicts", () => {
    expect(judgePlayback({ count: 1, a: sample(), b: sample({ paused: true }) }, 1500).verdict).toBe("paused");
    expect(judgePlayback({ count: 1, a: sample(), b: sample({ ended: true }) }, 1500).verdict).toBe("ended");
  });

  it("flags heavy frame drops while playing", () => {
    const j = judgePlayback(
      { count: 1, a: sample(), b: sample({ t: 11.4, q: { dropped: 20, total: 340 } }) },
      1500,
    );
    expect(j.verdict).toBe("playing");
    expect(j.reason).toContain("WARNING");
  });

  it("handles missing getVideoPlaybackQuality (older webviews)", () => {
    const j = judgePlayback(
      { count: 1, a: sample({ q: null }), b: sample({ q: null, t: 11.4 }) },
      1500,
    );
    expect(j.verdict).toBe("playing");
    expect(j.framesAdvanced).toBeUndefined();
  });
});

describe("buildSamplerExpression", () => {
  it("embeds selector safely and sample delay", () => {
    const expr = buildSamplerExpression(`video.player[data-x="1"]`, 1500);
    expect(expr).toContain(`querySelectorAll("video.player[data-x=\\"1\\"]")`);
    expect(expr).toContain("setTimeout(r, 1500)");
    expect(expr).toMatch(/^\(async \(\) => \{/);
  });
});
