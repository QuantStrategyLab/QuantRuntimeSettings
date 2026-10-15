// Check the emitted Vite references, including shared imports and preload lists.
export function validateV2Assets(html, assets) {
  const references = [];
  const inspect = (source, owner) => {
    for (const match of source.matchAll(/["']([^"'\s]+\.(?:js|css)(?:[?#][^"'\s]*)?)["']|url\(\s*([^"')\s]+\.(?:js|css)(?:[?#][^"')\s]*)?)\s*\)/g)) {
      const reference = match[1] || match[2];
      if (/^(?:[a-z]+:|\/\/)/i.test(reference)) continue;
      // Vite's preload dependency array uses paths relative to its /v2/ base.
      const base = reference.startsWith("assets/") ? "https://console.invalid/v2/" : `https://console.invalid${owner}`;
      const path = new URL(reference, base).pathname;
      if (!Object.hasOwn(assets, path)) throw new Error(`${owner} references missing embedded asset: ${path}`);
      references.push({ owner, path });
    }
  };
  inspect(html, "/");
  for (const [path, asset] of Object.entries(assets)) {
    if (/\.(?:js|css)$/.test(path)) inspect(Buffer.from(asset.base64, "base64").toString("utf8"), path);
  }
  return references;
}
