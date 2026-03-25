import process from "node:process";
import { readFileSync, existsSync } from "node:fs";
import libCoverage from "istanbul-lib-coverage";
import libReport from "istanbul-lib-report";
import reports from "istanbul-reports";

/**
 * Extract per-line execution counts from an istanbul file coverage object.
 */
function getLineCounts(fileCov) {
  const lines = {};
  for (const [id, count] of Object.entries(fileCov.s)) {
    const loc = fileCov.statementMap[id];
    for (let line = loc.start.line; line <= loc.end.line; line++) {
      lines[line] = Math.max(lines[line] || 0, count);
    }
  }
  return lines;
}

/**
 * Augment a base file coverage with line-level data from a secondary source.
 * Preserves the base's statementMap/branchMap/fnMap (which have proper
 * granularity from vitest) and adds execution counts from server-side coverage.
 */
function augment(base, secondary) {
  const lineCounts = getLineCounts(secondary);

  for (const [id, loc] of Object.entries(base.statementMap)) {
    for (let line = loc.start.line; line <= loc.end.line; line++) {
      if (lineCounts[line] > 0) {
        base.s[id] = (base.s[id] || 0) + lineCounts[line];
        break;
      }
    }
  }

  for (const [id, loc] of Object.entries(base.fnMap)) {
    const line = loc.decl.start.line;
    if (lineCounts[line] > 0) {
      base.f[id] = (base.f[id] || 0) + lineCounts[line];
    }
  }

  for (const [id, branch] of Object.entries(base.branchMap)) {
    for (let i = 0; i < branch.locations.length; i++) {
      const line = branch.locations[i].start.line;
      if (lineCounts[line] > 0) {
        base.b[id][i] = (base.b[id][i] || 0) + lineCounts[line];
      }
    }
  }
}

function loadJson(path) {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8"));
}

const [vitestPath, serverPath] = process.argv.slice(2);
const vitestData = loadJson(vitestPath);
const serverData = loadJson(serverPath);

const map = libCoverage.createCoverageMap({});

// Add all vitest coverage (has proper statement-level granularity).
map.merge(vitestData);

// For server-side coverage, either add new files directly or augment
// existing vitest entries with line-level execution data.
for (const [file, serverFileCov] of Object.entries(serverData)) {
  if (!file.includes("/src/")) continue;

  const vitestFileCov = vitestData[file];
  if (
    vitestFileCov &&
    Object.keys(vitestFileCov.statementMap).length >=
      Object.keys(serverFileCov.statementMap).length
  ) {
    augment(map.fileCoverageFor(file).data, serverFileCov);
  } else if (vitestFileCov) {
    // Server coverage has more mapped statements (vitest only partially
    // instrumented this file). Replace vitest's entry with server data
    // augmented by vitest's line-level counts.
    const serverCopy = JSON.parse(JSON.stringify(serverFileCov));
    augment(serverCopy, vitestFileCov);
    map.data[file] = libCoverage.createFileCoverage(serverCopy);
  } else {
    map.addFileCoverage(serverFileCov);
  }
}

const context = libReport.createContext({ coverageMap: map, dir: "coverage" });

for (const reporter of ["text", "lcov"]) {
  reports.create(reporter).execute(context);
}
