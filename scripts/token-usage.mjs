import { readdir, readFile } from "node:fs/promises";

// Read only persisted counters: never prompts, credentials or customer data.
const rows = [];
for (const group of ["branding", "translations"]) {
  const dir = new URL(`../data/${group}/`, import.meta.url);
  let files;
  try {
    files = await readdir(dir);
  } catch (error) {
    if (error.code === "ENOENT") continue;
    throw error;
  }
  for (const file of files.filter((name) => name.endsWith(".json"))) {
    const state = JSON.parse((await readFile(new URL(file, dir), "utf8")).replace(/^\uFEFF/, ""));
    const usage = state.usage;
    if (!usage) continue;
    const input = usage.inputTokens ?? 0;
    const cached = usage.cachedInputTokens ?? 0;
    rows.push({ stage: group, execution: file.slice(0, -5), input, cached,
      uncached: Math.max(0, input - cached), output: usage.outputTokens ?? 0 });
  }
}
console.table(rows.sort((a, b) => b.input - a.input));
console.table(["branding", "translations"].map((stage) => {
  const selected = rows.filter((row) => row.stage === stage);
  const sum = (key) => selected.reduce((total, row) => total + row[key], 0);
  return { stage, executions: selected.length, input: sum("input"),
    cached: sum("cached"), uncached: sum("uncached"), output: sum("output") };
}));
console.log("Cache is part of input, not additional tokens. Persisted workflow counters only; not a complete account/chat/image billing report. Failed calls may be missing. No AI calls made.");
