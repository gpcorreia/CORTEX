// Format conversion only. Originals in copy/ and existing product projects are never touched.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
const root = fileURLToPath(new URL("../", import.meta.url));
const target = path.resolve(process.argv[2] ?? "");
const jobs = await fs.realpath(path.join(root, "projects"));
const actual = await fs.realpath(target);
if (path.dirname(actual) !== jobs)
  throw new Error(
    "Only the selected direct product directory can be converted.",
  );
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage();
await page.route("https://convert.local/**", (r) =>
  r.fulfill({ contentType: "text/html", body: "<html></html>" }),
);
await page.goto("https://convert.local/");
const changes = new Map();
async function convert(dir) {
  for (const entry of await fs
    .readdir(dir, { withFileTypes: true })
    .catch(() => [])) {
    const file = path.join(dir, entry.name);
    if (entry.isSymbolicLink())
      throw new Error("Symbolic links are not allowed.");
    if (entry.isDirectory()) await convert(file);
    else if (
      /\.(png|jpe?g)$/i.test(file) &&
      !/^reference\./i.test(entry.name)
    ) {
      const original = await fs.readFile(file);
      const result = await page.evaluate(
        async (data) => {
          const blob = await (await fetch(data)).blob();
          const bitmap = await createImageBitmap(blob);
          const canvas = document.createElement("canvas");
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          canvas.getContext("2d").drawImage(bitmap, 0, 0);
          bitmap.close();
          return canvas.toDataURL("image/webp", 1).split(",")[1];
        },
        `data:image/${/\.png$/i.test(file) ? "png" : "jpeg"};base64,${original.toString("base64")}`,
      );
      const output = file.replace(/\.(png|jpe?g)$/i, ".webp");
      try {
        await fs.access(output);
        throw new Error(`Output already exists: ${output}`);
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
      await fs.writeFile(output, Buffer.from(result, "base64"));
      const relative = path.relative(actual, file).split(path.sep).join("/");
      changes.set(
        relative,
        path.relative(actual, output).split(path.sep).join("/"),
      );
      await fs.unlink(file);
    }
  }
}
try {
  for (const folder of ["brand", "advertorial/generator", "content/generator"])
    await convert(path.join(actual, folder));
  const rewrite = (value) =>
    typeof value === "string"
      ? (changes.get(value) ?? value)
      : Array.isArray(value)
        ? value.map(rewrite)
        : value && typeof value === "object"
          ? Object.fromEntries(
              Object.entries(value).map(([k, v]) => [k, rewrite(v)]),
            )
          : value;
  for (const file of [
    "content/manifest.json",
    "content/localization-map.json",
    "brand/brand.json",
  ]) {
    const full = path.join(actual, file);
    try {
      await fs.writeFile(
        full,
        JSON.stringify(
          rewrite(JSON.parse(await fs.readFile(full, "utf8"))),
          null,
          2,
        ),
      );
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  console.log(
    JSON.stringify({
      converted: changes.size,
      files: Object.fromEntries(changes),
    }),
  );
} finally {
  await browser.close();
}
