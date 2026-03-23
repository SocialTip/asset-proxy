#!/usr/bin/env npx tsx

/**
 * Creates a markdown test plan for asset-proxy deployments.
 *
 * Usage:
 *   npx tsx scripts/create-test-plan.ts \
 *     --video "gs://my-bucket/test-video.mp4" \
 *     --image "gs://my-bucket/test-image.jpg" \
 *     --url "https://asset-proxy.example.com" \
 *     --signing-key-secret "projects/my-proj/secrets/signing-key/versions/latest" \
 *     --signing-salt-secret "projects/my-proj/secrets/signing-salt/versions/latest" \
 *     --encryption-key-secret "projects/my-proj/secrets/encryption-key/versions/latest"
 */

import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
  generateUrl,
  generateInfoUrl,
  type UrlGeneratorConfig,
} from "@socialtip/asset-proxy-url-generator";

const { values } = parseArgs({
  options: {
    video: { type: "string" },
    image: { type: "string" },
    url: { type: "string" },
    "signing-key-secret": { type: "string" },
    "signing-salt-secret": { type: "string" },
    "encryption-key-secret": { type: "string" },
  },
  strict: true,
});

const videoUrl = values.video;
const imageUrl = values.image;
const baseUrl = values.url?.replace(/\/$/, "");

if (!videoUrl || !imageUrl || !baseUrl) {
  console.error(
    "Required: --video <gs:// URL> --image <gs:// URL> --url <deployment URL>",
  );
  process.exit(1);
}

function formatTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

const planTimestamp = formatTimestamp(new Date());
const planDir = join("test-plans", planTimestamp);
mkdirSync(planDir, { recursive: true });
const outputPath = join(planDir, "plan.md");

function fetchSecret(secretName: string): string {
  return execSync(
    `gcloud secrets versions access latest --secret="${secretName}"`,
    { encoding: "utf-8" },
  ).trim();
}

const hasSigningKey = !!values["signing-key-secret"];
const hasSigningSalt = !!values["signing-salt-secret"];

if (hasSigningKey !== hasSigningSalt) {
  console.error(
    "--signing-key-secret and --signing-salt-secret must be provided together",
  );
  process.exit(1);
}

const signingKey = values["signing-key-secret"]
  ? fetchSecret(values["signing-key-secret"])
  : undefined;
const signingSalt = values["signing-salt-secret"]
  ? fetchSecret(values["signing-salt-secret"])
  : undefined;
const encryptionKey = values["encryption-key-secret"]
  ? fetchSecret(values["encryption-key-secret"])
  : undefined;

const config: UrlGeneratorConfig = {
  ...(signingKey && signingSalt ? { signingKey, signingSalt } : {}),
  ...(encryptionKey ? { encryptionKey } : {}),
};

function url(path: string): string {
  return `${baseUrl}${path}`;
}

interface Test {
  name: string;
  command: string;
  checks: string[];
}

interface TestSection {
  title: string;
  tests: Test[];
}

const sections: TestSection[] = [];

const imageTests: Test[] = [];

imageTests.push({
  name: "Resize (fill 480x360)",
  command: `curl -sS -o test-image-resize-fill.jpg -w 'TTFB:%{time_starttransfer} Total:%{time_total}' '${url(generateUrl({ sourceUrl: imageUrl, resize: { type: "fill", width: 480, height: 360 } }, config))}'`,
  checks: [
    "Output file size",
    "Output dimensions (expect 480x360)",
    "Latency (TTFB)",
    "Total time",
  ],
});

imageTests.push({
  name: "Resize (fit 480x360)",
  command: `curl -sS -o test-image-resize-fit.jpg -w 'TTFB:%{time_starttransfer} Total:%{time_total}' '${url(generateUrl({ sourceUrl: imageUrl, resize: { type: "fit", width: 480, height: 360 } }, config))}'`,
  checks: [
    "Output file size",
    "Output dimensions (expect fit within 480x360)",
    "Latency (TTFB)",
    "Total time",
  ],
});

imageTests.push({
  name: "Width only (300)",
  command: `curl -sS -o test-image-width.jpg -w 'TTFB:%{time_starttransfer} Total:%{time_total}' '${url(generateUrl({ sourceUrl: imageUrl, resize: { type: "fit", width: 300, height: 0 } }, config))}'`,
  checks: [
    "Output file size",
    "Output dimensions (expect width=300)",
    "Latency (TTFB)",
    "Total time",
  ],
});

imageTests.push({
  name: "Quality (q:30)",
  command: `curl -sS -o test-image-q30.jpg -w 'TTFB:%{time_starttransfer} Total:%{time_total}' '${url(generateUrl({ sourceUrl: imageUrl, resize: { type: "fit", width: 480, height: 0 }, quality: 30 }, config))}'`,
  checks: [
    "Output file size (expect smaller than default quality)",
    "Output dimensions",
    "Latency (TTFB)",
    "Total time",
  ],
});

imageTests.push({
  name: "Format conversion (jpg to webp)",
  command: `curl -sS -o test-image-format.webp -w 'TTFB:%{time_starttransfer} Total:%{time_total}' '${url(generateUrl({ sourceUrl: imageUrl, resize: { type: "fit", width: 480, height: 0 }, outputFormat: "webp" }, config))}'`,
  checks: [
    "Output file size",
    "Output dimensions",
    "Output format (expect webp)",
    "Latency (TTFB)",
    "Total time",
  ],
});

imageTests.push({
  name: "Format conversion (jpg to avif)",
  command: `curl -sS -o test-image-format.avif -w 'TTFB:%{time_starttransfer} Total:%{time_total}' '${url(generateUrl({ sourceUrl: imageUrl, resize: { type: "fit", width: 480, height: 0 }, outputFormat: "avif" }, config))}'`,
  checks: [
    "Output file size",
    "Output dimensions",
    "Output format (expect avif)",
    "Latency (TTFB)",
    "Total time",
  ],
});

imageTests.push({
  name: "Format conversion (jpg to png)",
  command: `curl -sS -o test-image-format.png -w 'TTFB:%{time_starttransfer} Total:%{time_total}' '${url(generateUrl({ sourceUrl: imageUrl, resize: { type: "fit", width: 480, height: 0 }, outputFormat: "png" }, config))}'`,
  checks: [
    "Output file size",
    "Output dimensions",
    "Output format (expect png)",
    "Latency (TTFB)",
    "Total time",
  ],
});

imageTests.push({
  name: "Best format",
  command: `curl -sS -D headers.tmp -o test-image-best.tmp -w 'TTFB:%{time_starttransfer} Total:%{time_total}' '${url(generateUrl({ sourceUrl: imageUrl, resize: { type: "fit", width: 480, height: 0 }, bestFormat: true }, config))}' && fn=$(sed -n 's/.*filename="\\([^"]*\\)".*/\\1/p' headers.tmp) && mv test-image-best.tmp "test-image-best-$fn" && rm headers.tmp`,
  checks: [
    "Output file size",
    "Output format (check extension from Content-Disposition)",
    "Latency (TTFB)",
    "Total time",
  ],
});

imageTests.push({
  name: "Blur (sigma 5)",
  command: `curl -sS -o test-image-blur.jpg -w 'TTFB:%{time_starttransfer} Total:%{time_total}' '${url(generateUrl({ sourceUrl: imageUrl, resize: { type: "fit", width: 480, height: 0 }, blur: 5 }, config))}'`,
  checks: [
    "Output file size",
    "Output dimensions",
    "Latency (TTFB)",
    "Total time",
  ],
});

imageTests.push({
  name: "Sharpen (sigma 1.5)",
  command: `curl -sS -o test-image-sharpen.jpg -w 'TTFB:%{time_starttransfer} Total:%{time_total}' '${url(generateUrl({ sourceUrl: imageUrl, resize: { type: "fit", width: 480, height: 0 }, sharpen: 1.5 }, config))}'`,
  checks: [
    "Output file size",
    "Output dimensions",
    "Latency (TTFB)",
    "Total time",
  ],
});

imageTests.push({
  name: "Rotate 90",
  command: `curl -sS -o test-image-rotate.jpg -w 'TTFB:%{time_starttransfer} Total:%{time_total}' '${url(generateUrl({ sourceUrl: imageUrl, resize: { type: "fit", width: 480, height: 0 }, rotate: 90 }, config))}'`,
  checks: [
    "Output file size",
    "Output dimensions (expect swapped w/h)",
    "Latency (TTFB)",
    "Total time",
  ],
});

imageTests.push({
  name: "Flip horizontal",
  command: `curl -sS -o test-image-flip.jpg -w 'TTFB:%{time_starttransfer} Total:%{time_total}' '${url(generateUrl({ sourceUrl: imageUrl, resize: { type: "fit", width: 480, height: 0 }, flip: { horizontal: true, vertical: false } }, config))}'`,
  checks: [
    "Output file size",
    "Output dimensions",
    "Latency (TTFB)",
    "Total time",
  ],
});

imageTests.push({
  name: "Crop aspect ratio (1:1)",
  command: `curl -sS -o test-image-car.jpg -w 'TTFB:%{time_starttransfer} Total:%{time_total}' '${url(generateUrl({ sourceUrl: imageUrl, resize: { type: "fit", width: 480, height: 0 }, cropAspectRatio: 1 }, config))}'`,
  checks: [
    "Output file size",
    "Output dimensions (expect square)",
    "Latency (TTFB)",
    "Total time",
  ],
});

imageTests.push({
  name: "Brightness (+50)",
  command: `curl -sS -o test-image-bright.jpg -w 'TTFB:%{time_starttransfer} Total:%{time_total}' '${url(generateUrl({ sourceUrl: imageUrl, resize: { type: "fit", width: 480, height: 0 }, brightness: 50 }, config))}'`,
  checks: [
    "Output file size",
    "Output dimensions",
    "Latency (TTFB)",
    "Total time",
  ],
});

imageTests.push({
  name: "Monochrome",
  command: `curl -sS -o test-image-mono.jpg -w 'TTFB:%{time_starttransfer} Total:%{time_total}' '${url(generateUrl({ sourceUrl: imageUrl, resize: { type: "fit", width: 480, height: 0 }, monochrome: { intensity: 1, colour: "b3b3b3" } }, config))}'`,
  checks: [
    "Output file size",
    "Output dimensions",
    "Latency (TTFB)",
    "Total time",
  ],
});

imageTests.push({
  name: "Pixelate (10)",
  command: `curl -sS -o test-image-pixelate.jpg -w 'TTFB:%{time_starttransfer} Total:%{time_total}' '${url(generateUrl({ sourceUrl: imageUrl, resize: { type: "fit", width: 480, height: 0 }, pixelate: 10 }, config))}'`,
  checks: [
    "Output file size",
    "Output dimensions",
    "Latency (TTFB)",
    "Total time",
  ],
});

imageTests.push({
  name: "Padding (20px, red background)",
  command: `curl -sS -o test-image-padding.jpg -w 'TTFB:%{time_starttransfer} Total:%{time_total}' '${url(generateUrl({ sourceUrl: imageUrl, resize: { type: "fit", width: 480, height: 0 }, padding: { top: 20, right: 20, bottom: 20, left: 20 }, background: { r: 255, g: 0, b: 0 } }, config))}'`,
  checks: [
    "Output file size",
    "Output dimensions (expect +40px each side)",
    "Latency (TTFB)",
    "Total time",
  ],
});

imageTests.push({
  name: "Gradient overlay",
  command: `curl -sS -o test-image-gradient.jpg -w 'TTFB:%{time_starttransfer} Total:%{time_total}' '${url(generateUrl({ sourceUrl: imageUrl, resize: { type: "fit", width: 480, height: 0 }, gradient: { opacity: 0.5, colour: "000", direction: "down", start: 0, stop: 0.5 } }, config))}'`,
  checks: [
    "Output file size",
    "Output dimensions",
    "Latency (TTFB)",
    "Total time",
  ],
});

imageTests.push({
  name: "Raw passthrough",
  command: `curl -sS -o test-image-raw.jpg -w 'TTFB:%{time_starttransfer} Total:%{time_total}' '${url(generateUrl({ sourceUrl: imageUrl, raw: true }, config))}'`,
  checks: [
    "Output file size (expect same as source)",
    "Latency (TTFB)",
    "Total time",
  ],
});

sections.push({ title: "Image Processing", tests: imageTests });

const videoTests: Test[] = [];

videoTests.push({
  name: "Resize (fill 480x360)",
  command: `curl -sS -o test-video-resize-fill.mp4 -w 'TTFB:%{time_starttransfer} Total:%{time_total}' '${url(generateUrl({ sourceUrl: videoUrl, resize: { type: "fill", width: 480, height: 360 } }, config))}'`,
  checks: [
    "Output file size",
    "Output dimensions (expect 480x360)",
    "Output duration",
    "Latency (TTFB)",
    "Total time",
  ],
});

videoTests.push({
  name: "Resize (fit 480x360)",
  command: `curl -sS -o test-video-resize-fit.mp4 -w 'TTFB:%{time_starttransfer} Total:%{time_total}' '${url(generateUrl({ sourceUrl: videoUrl, resize: { type: "fit", width: 480, height: 360 } }, config))}'`,
  checks: [
    "Output file size",
    "Output dimensions (expect fit within 480x360)",
    "Output duration",
    "Latency (TTFB)",
    "Total time",
  ],
});

videoTests.push({
  name: "Resize (force 480x360)",
  command: `curl -sS -o test-video-resize-force.mp4 -w 'TTFB:%{time_starttransfer} Total:%{time_total}' '${url(generateUrl({ sourceUrl: videoUrl, resize: { type: "force", width: 480, height: 360 } }, config))}'`,
  checks: [
    "Output file size",
    "Output dimensions (expect exactly 480x360, may be stretched)",
    "Output duration",
    "Latency (TTFB)",
    "Total time",
  ],
});

videoTests.push({
  name: "Cut (first 5 seconds)",
  command: `curl -sS -o test-video-cut.mp4 -w 'TTFB:%{time_starttransfer} Total:%{time_total}' '${url(generateUrl({ sourceUrl: videoUrl, cut: 5 }, config))}'`,
  checks: [
    "Output file size",
    "Output dimensions (expect same as source)",
    "Output duration (expect ~5s)",
    "Latency (TTFB)",
    "Total time",
  ],
});

videoTests.push({
  name: "Mute",
  command: `curl -sS -o test-video-mute.mp4 -w 'TTFB:%{time_starttransfer} Total:%{time_total}' '${url(generateUrl({ sourceUrl: videoUrl, mute: true }, config))}'`,
  checks: [
    "Output file size",
    "Output dimensions (expect same as source)",
    "Audio track (expect none)",
    "Latency (TTFB)",
    "Total time",
  ],
});

videoTests.push({
  name: "Framerate (15fps)",
  command: `curl -sS -o test-video-fr15.mp4 -w 'TTFB:%{time_starttransfer} Total:%{time_total}' '${url(generateUrl({ sourceUrl: videoUrl, framerate: 15 }, config))}'`,
  checks: [
    "Output file size",
    "Output dimensions (expect same as source)",
    "Output framerate (expect 15fps)",
    "Latency (TTFB)",
    "Total time",
  ],
});

videoTests.push({
  name: "Format conversion (mp4 to webm)",
  command: `curl -sS -o test-video-format.webm -w 'TTFB:%{time_starttransfer} Total:%{time_total}' '${url(generateUrl({ sourceUrl: videoUrl, outputFormat: "webm" }, config))}'`,
  checks: [
    "Output file size",
    "Output dimensions (expect same as source)",
    "Output format (expect webm/vp9)",
    "Latency (TTFB)",
    "Total time",
  ],
});

videoTests.push({
  name: "Combined (resize fill + mute + 15fps + cut 5s)",
  command: `curl -sS -o test-video-combined.mp4 -w 'TTFB:%{time_starttransfer} Total:%{time_total}' '${url(generateUrl({ sourceUrl: videoUrl, resize: { type: "fill", width: 480, height: 360 }, mute: true, framerate: 15, cut: 5 }, config))}'`,
  checks: [
    "Output file size",
    "Output dimensions (expect 480x360)",
    "Output duration (expect ~5s)",
    "Output framerate (expect 15fps)",
    "Audio track (expect none)",
    "Latency (TTFB)",
    "Total time",
  ],
});

videoTests.push({
  name: "Video thumbnail (image at 2s)",
  command: `curl -sS -o test-video-thumb.jpg -w 'TTFB:%{time_starttransfer} Total:%{time_total}' '${url(generateUrl({ sourceUrl: videoUrl, videoThumbnailSecond: 2, outputFormat: "jpg" }, config))}'`,
  checks: [
    "Output file size",
    "Output dimensions (expect same as source)",
    "Output format (expect jpg)",
    "Latency (TTFB)",
    "Total time",
  ],
});

videoTests.push({
  name: "Animated thumbnail fit (gif)",
  command: `curl -sS -o test-video-anim-fit.gif -w 'TTFB:%{time_starttransfer} Total:%{time_total}' '${url(generateUrl({ sourceUrl: videoUrl, videoThumbnailAnimation: { step: 1, delay: 100, frames: 5, frameWidth: 320, frameHeight: 180, extendFrame: false, trim: false, fill: false, focusX: 0.5, focusY: 0.5 }, outputFormat: "gif" }, config))}'`,
  checks: [
    "Output file size",
    "Output dimensions (expect fit within 320x180)",
    "Frame count (expect 5)",
    "Latency (TTFB)",
    "Total time",
  ],
});

videoTests.push({
  name: "Animated thumbnail fill (gif)",
  command: `curl -sS -o test-video-anim-fill.gif -w 'TTFB:%{time_starttransfer} Total:%{time_total}' '${url(generateUrl({ sourceUrl: videoUrl, videoThumbnailAnimation: { step: 1, delay: 100, frames: 5, frameWidth: 320, frameHeight: 180, extendFrame: false, trim: false, fill: true, focusX: 0.5, focusY: 0.5 }, outputFormat: "gif" }, config))}'`,
  checks: [
    "Output file size",
    "Output dimensions (expect 320x180)",
    "Frame count (expect 5)",
    "Latency (TTFB)",
    "Total time",
  ],
});

sections.push({ title: "Video Processing", tests: videoTests });

const infoTests: Test[] = [];

infoTests.push({
  name: "Image info (basic)",
  command: `curl -sS -w '\\nTTFB:%{time_starttransfer} Total:%{time_total}' '${url(generateInfoUrl({ sourceUrl: imageUrl }, config))}'`,
  checks: ["JSON response", "Latency (TTFB)", "Total time"],
});

infoTests.push({
  name: "Image info (with EXIF)",
  command: `curl -sS -w '\\nTTFB:%{time_starttransfer} Total:%{time_total}' '${url(generateInfoUrl({ sourceUrl: imageUrl }, config, { exif: true }))}'`,
  checks: ["JSON response (expect exif field)", "Latency (TTFB)", "Total time"],
});

infoTests.push({
  name: "Image info (with hashsums)",
  command: `curl -sS -w '\\nTTFB:%{time_starttransfer} Total:%{time_total}' '${url(generateInfoUrl({ sourceUrl: imageUrl }, config, { calcHashsums: ["sha256"] }))}'`,
  checks: [
    "JSON response (expect hashsums field)",
    "Latency (TTFB)",
    "Total time",
  ],
});

infoTests.push({
  name: "Image info (with dominant colours)",
  command: `curl -sS -w '\\nTTFB:%{time_starttransfer} Total:%{time_total}' '${url(generateInfoUrl({ sourceUrl: imageUrl }, config, { dominantColors: true }))}'`,
  checks: [
    "JSON response (expect dominant_colors field)",
    "Latency (TTFB)",
    "Total time",
  ],
});

infoTests.push({
  name: "Image info (with blurhash)",
  command: `curl -sS -w '\\nTTFB:%{time_starttransfer} Total:%{time_total}' '${url(generateInfoUrl({ sourceUrl: imageUrl }, config, { blurhash: { xComponents: 4, yComponents: 3 } }))}'`,
  checks: [
    "JSON response (expect blurhash field)",
    "Latency (TTFB)",
    "Total time",
  ],
});

infoTests.push({
  name: "Video info",
  command: `curl -sS -w '\\nTTFB:%{time_starttransfer} Total:%{time_total}' '${url(generateInfoUrl({ sourceUrl: videoUrl }, config))}'`,
  checks: [
    "JSON response (expect video_meta field)",
    "Latency (TTFB)",
    "Total time",
  ],
});

sections.push({ title: "Info Endpoint", tests: infoTests });

const lines: string[] = [];

lines.push("# Asset Proxy Test Plan");
lines.push("");
lines.push(`**Deployment:** ${baseUrl}`);
lines.push(`**Test image:** \`${imageUrl}\``);
lines.push(`**Test video:** \`${videoUrl}\``);
lines.push(`**Signing:** ${signingKey ? "enabled" : "disabled"}`);
lines.push(`**Encryption:** ${encryptionKey ? "enabled" : "disabled"}`);
lines.push(`**Last run:** _not yet run_`);
lines.push("");
lines.push("---");
lines.push("");
lines.push("## Instructions");
lines.push("");
lines.push(
  "Each test below contains a command to run and a results table to fill in.",
);
lines.push("");
lines.push("### Directory structure");
lines.push("");
lines.push(
  "This plan lives in `test-plans/<timestamp>/plan.md`. When running the plan, create a subdirectory named with the run timestamp:",
);
lines.push("");
lines.push("```");
lines.push("test-plans/");
lines.push(`  ${planTimestamp}/`);
lines.push("    plan.md");
lines.push("    run-YYYY-MM-DD-HH-MM-SS/");
lines.push("      test-image-resize-fill.jpg");
lines.push("      test-video-resize.mp4");
lines.push("      ...");
lines.push("```");
lines.push("");
lines.push(
  "Before running tests, verify the deployment is up and `cd` into a new run directory:",
);
lines.push("");
lines.push("```sh");
lines.push(
  `curl -sf '${baseUrl}/health' || { echo 'Health check failed'; exit 1; }`,
);
lines.push(`mkdir -p ${planDir}/run-$(date +%Y-%m-%d-%H-%M-%S) && cd $_`);
lines.push("```");
lines.push("");
lines.push("### Running manually");
lines.push("");
lines.push(
  "Run each `curl` command from the run directory. Use `ffprobe` / `file` / `stat` to inspect output files and fill in the results tables.",
);
lines.push("");
lines.push("### Running with Claude");
lines.push("");
lines.push("Tell Claude:");
lines.push("");
lines.push(
  `> I've created a test plan for asset proxy in \`${outputPath}\`. Run it for me please.`,
);
lines.push("");
lines.push(
  'Claude must run the "Run all" script below exactly as written — do not modify, reorder, parallelise, or skip any commands. Run the entire script sequentially in a single bash invocation. After all commands complete, inspect each output file using `ffprobe` / `file` / `stat`, fill in the results tables, and update the "Last run" timestamp. For info endpoint tests, paste the JSON response into the result cell.',
);
lines.push("");

const allCommands: string[] = [];
for (const section of sections) {
  for (const test of section.tests) {
    allCommands.push(`echo '>>> ${test.name}' && ${test.command}`);
  }
}

lines.push("### Run all");
lines.push("");
lines.push("```sh");
lines.push(
  `curl -sf '${baseUrl}/health' || { echo 'Health check failed'; exit 1; }`,
);
lines.push(`mkdir -p ${planDir}/run-$(date +%Y-%m-%d-%H-%M-%S) && cd $_`);
lines.push(allCommands.join(" && \\\n"));
lines.push("```");
lines.push("");

for (const section of sections) {
  lines.push(`## ${section.title}`);
  lines.push("");

  for (const test of section.tests) {
    lines.push(`### ${test.name}`);
    lines.push("");
    lines.push("```sh");
    lines.push(test.command);
    lines.push("```");
    lines.push("");
    lines.push("| Metric | Result |");
    lines.push("|--------|--------|");
    const outputFileMatch = test.command.match(/-o (\S+)/);
    if (outputFileMatch) {
      if (outputFileMatch[1].endsWith(".tmp")) {
        lines.push("| Output file | |");
      } else {
        lines.push(`| Output file | \`${outputFileMatch[1]}\` |`);
      }
    }
    for (const check of test.checks) {
      lines.push(`| ${check} | |`);
    }
    lines.push("");
  }
}

const content = lines.join("\n");
writeFileSync(outputPath, content, "utf-8");
console.log(`Test plan written to ${outputPath}`);
