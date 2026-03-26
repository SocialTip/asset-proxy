import process from "node:process";
import { existsSync } from "node:fs";
import { CoverageReport } from "monocart-coverage-reports";

const [vitestRawDir, serverRawDir] = process.argv.slice(2);

const report = new CoverageReport({
  name: "Merged Coverage",
  inputDir: vitestRawDir && existsSync(vitestRawDir) ? [vitestRawDir] : [],
  outputDir: "coverage",
  reports: ["console-details", "v8"],
  lcov: true,
  entryFilter: (entry) =>
    !entry.url.includes("node_modules") &&
    (entry.url.includes("/src/") || entry.url.includes("/dist/")),
  sourceFilter: (sourcePath) =>
    !sourcePath.includes("node_modules") && sourcePath.includes("/src/"),
});

report.cleanCache();

if (serverRawDir && existsSync(serverRawDir)) {
  await report.addFromDir(serverRawDir);
}

await report.generate();
