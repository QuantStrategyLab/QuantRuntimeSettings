// Size budget check for the built console (design spec §7).
// Fails the build when a limit is exceeded.
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const distRoot = resolve(fileURLToPath(new URL("../dist", import.meta.url)));

const KB = 1024;
const LIMITS = {
  entryJs: 150 * KB, // first-screen JS, gzipped
  chunkJs: 60 * KB, // each lazy page chunk, gzipped
  css: 20 * KB, // total CSS, gzipped
  images: 20 * KB, // all icons/images combined, raw
};

async function walk(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await walk(path)));
    else if (entry.isFile()) found.push(path);
  }
  return found;
}

const files = await walk(distRoot);
const html = await readFile(join(distRoot, "index.html"), "utf8");
const entryScripts = [...html.matchAll(/src="[^"]*assets\/([^"]+\.js)"/g)].map(match => match[1]);

const failures = [];
let cssGz = 0;
let imageBytes = 0;

for (const path of files) {
  const name = path.slice(distRoot.length + 1).split("\\").join("/");
  const bytes = await readFile(path);
  if (name.endsWith(".js")) {
    const gz = gzipSync(bytes).length;
    const base = name.replace(/^assets\//, "");
    const isEntry = entryScripts.includes(base);
    const limit = isEntry ? LIMITS.entryJs : LIMITS.chunkJs;
    if (gz > limit) failures.push(`${name}: ${(gz / KB).toFixed(1)}KB gz exceeds ${(limit / KB).toFixed(0)}KB (${isEntry ? "entry" : "chunk"})`);
    console.log(`${isEntry ? "entry" : "chunk"} ${name}: ${(gz / KB).toFixed(1)}KB gz`);
  } else if (name.endsWith(".css")) {
    cssGz += gzipSync(bytes).length;
  } else if (/\.(png|svg|jpg|webp|ico)$/.test(name)) {
    imageBytes += bytes.length;
  }
}

if (cssGz > LIMITS.css) failures.push(`CSS total ${(cssGz / KB).toFixed(1)}KB gz exceeds ${(LIMITS.css / KB).toFixed(0)}KB`);
if (imageBytes > LIMITS.images) failures.push(`images total ${(imageBytes / KB).toFixed(1)}KB exceeds ${(LIMITS.images / KB).toFixed(0)}KB`);
console.log(`css total: ${(cssGz / KB).toFixed(1)}KB gz; images total: ${(imageBytes / KB).toFixed(1)}KB`);

if (failures.length) {
  console.error("Size budget exceeded:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("Size budget OK.");
