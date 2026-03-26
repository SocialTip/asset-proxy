import process from "node:process";
import { readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";

const [vitestLcov, serverLcov] = process.argv.slice(2);

let raw = "";
if (vitestLcov && existsSync(vitestLcov)) {
  raw += readFileSync(vitestLcov, "utf8");
}
if (serverLcov && existsSync(serverLcov)) {
  raw += readFileSync(serverLcov, "utf8");
}

// Parse lcov into per-file records, merging duplicates by taking the max
// count per line/function/branch.
const files = new Map();

let current = null;
for (const line of raw.split("\n")) {
  const t = line.trim();

  if (t.startsWith("SF:")) {
    const path = t.slice(3);
    if (!files.has(path)) {
      files.set(path, { path, lines: new Map(), fns: new Map(), branches: new Map() });
    }
    current = files.get(path);
  } else if (t.startsWith("DA:") && current) {
    const [ln, count] = t.slice(3).split(",").map(Number);
    current.lines.set(ln, Math.max(current.lines.get(ln) ?? 0, count));
  } else if (t.startsWith("FN:") && current) {
    const comma = t.indexOf(",", 3);
    const startLine = Number(t.slice(3, comma));
    const name = t.slice(comma + 1);
    if (!current.fns.has(name)) {
      current.fns.set(name, { startLine, count: 0 });
    }
  } else if (t.startsWith("FNDA:") && current) {
    const comma = t.indexOf(",", 5);
    const count = Number(t.slice(5, comma));
    const name = t.slice(comma + 1);
    const fn = current.fns.get(name);
    if (fn) fn.count = Math.max(fn.count, count);
  } else if (t.startsWith("BRDA:") && current) {
    const [ln, blockId, branchId, countStr] = t.slice(5).split(",");
    const count = countStr === "-" ? 0 : Number(countStr);
    const key = `${ln},${blockId},${branchId}`;
    current.branches.set(key, Math.max(current.branches.get(key) ?? 0, count));
  } else if (t === "end_of_record") {
    current = null;
  }
}

// Write merged lcov.
let lcov = "";
for (const [path, file] of files) {
  lcov += `TN:\nSF:${path}\n`;
  for (const [name, fn] of file.fns) {
    lcov += `FN:${fn.startLine},${name}\n`;
  }
  for (const [name, fn] of file.fns) {
    lcov += `FNDA:${fn.count},${name}\n`;
  }
  lcov += `FNF:${file.fns.size}\n`;
  lcov += `FNH:${[...file.fns.values()].filter((f) => f.count > 0).length}\n`;
  for (const [ln, count] of [...file.lines].sort((a, b) => a[0] - b[0])) {
    lcov += `DA:${ln},${count}\n`;
  }
  lcov += `LF:${file.lines.size}\n`;
  lcov += `LH:${[...file.lines.values()].filter((c) => c > 0).length}\n`;
  for (const [key, count] of file.branches) {
    lcov += `BRDA:${key},${count}\n`;
  }
  lcov += `BRF:${file.branches.size}\n`;
  lcov += `BRH:${[...file.branches.values()].filter((c) => c > 0).length}\n`;
  lcov += "end_of_record\n";
}

writeFileSync("coverage/lcov.info", lcov);

// Regenerate the lcov HTML report and console summary from the merged data.
const { default: libCoverage } = await import("istanbul-lib-coverage");
const { default: libReport } = await import("istanbul-lib-report");
const { default: istanbulReports } = await import("istanbul-reports");

const map = libCoverage.createCoverageMap({});

for (const [path, file] of files) {
  const fc = {
    path,
    statementMap: {},
    s: {},
    branchMap: {},
    b: {},
    fnMap: {},
    f: {},
  };

  let si = 0;
  for (const [ln, count] of [...file.lines].sort((a, b) => a[0] - b[0])) {
    const id = String(si++);
    fc.statementMap[id] = {
      start: { line: ln, column: 0 },
      end: { line: ln, column: 0 },
    };
    fc.s[id] = count;
  }

  let fi = 0;
  for (const [name, fn] of file.fns) {
    const id = String(fi++);
    fc.fnMap[id] = {
      name,
      decl: { start: { line: fn.startLine, column: 0 }, end: { line: fn.startLine, column: 0 } },
      loc: { start: { line: fn.startLine, column: 0 }, end: { line: fn.startLine, column: 0 } },
    };
    fc.f[id] = fn.count;
  }

  let bi = 0;
  for (const [key, count] of file.branches) {
    const [ln, blockId, branchId] = key.split(",");
    const bKey = String(blockId);
    if (!fc.branchMap[bKey]) {
      fc.branchMap[bKey] = {
        type: "branch",
        loc: { start: { line: Number(ln), column: 0 }, end: { line: Number(ln), column: 0 } },
        locations: [],
      };
      fc.b[bKey] = [];
    }
    fc.branchMap[bKey].locations.push({
      start: { line: Number(ln), column: 0 },
      end: { line: Number(ln), column: 0 },
    });
    fc.b[bKey].push(count);
  }

  map.addFileCoverage(fc);
}

rmSync("coverage/lcov-report", { recursive: true, force: true });

const context = libReport.createContext({ coverageMap: map, dir: "coverage" });
istanbulReports.create("text").execute(context);
istanbulReports.create("lcov").execute(context);
