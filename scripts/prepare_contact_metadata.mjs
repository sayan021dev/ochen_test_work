// Preparation only: sample the real body, never a reference composition.
// Output contains source contact/receiving points; runtime remains vector-only.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { chromium } from "../frontend/node_modules/@playwright/test/index.mjs";

const sources = JSON.parse(
  execFileSync(
    ".venv/bin/python",
    [
      "-c",
      `
import hashlib,json
from xml.etree import ElementTree as ET
from app.catalog import CATALOG,asset_for
from app.svg import parse_safe_svg
from app.shadow import with_custom_shadow
from app.models import Shadow
out=[]
for entry in CATALOG:
 a=asset_for(entry['family'],entry['detail'],entry['role'])
 root=with_custom_shadow(parse_safe_svg(a['svg']),a,Shadow(),preserve_source=True,
                         receiver_only_body=True)
 for child in list(root):
  if child.get('data-custom-shadow'): root.remove(child)
 ground=a['shadow']['projection']['ground']
 out.append(dict(id=a['id'],width=a['width'],height=a['height'],
                 source_sha256=hashlib.sha256(a['svg'].encode()).hexdigest(),
                 contact=[(ground[0]+ground[2])/2,(ground[1]+ground[3])/2],
                 svg=ET.tostring(root,encoding='unicode')))
print(json.dumps(out))
`,
    ],
    { env: { ...process.env, PYTHONPATH: "backend" }, maxBuffer: 10_000_000 },
  ),
);

const browser = await chromium.launch({
  headless: true,
  channel: process.env.CI ? undefined : "chrome",
});
try {
  const page = await browser.newPage();
  const output = {};
  for (const source of sources) {
    const surface = await page.evaluate(async ({ svg, width, height }) => {
      const ratio = 256 / Math.max(width, height);
      const w = Math.ceil(width * ratio),
        h = Math.ceil(height * ratio);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      const image = new Image();
      image.src = "data:image/svg+xml;base64," + btoa(svg);
      await image.decode();
      context.drawImage(image, 0, 0, w, h);
      const pixels = context.getImageData(0, 0, w, h).data;
      const distance = new Float64Array(w * h);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++)
          distance[y * w + x] =
            pixels[(y * w + x) * 4 + 3] > 220 &&
            x &&
            y &&
            x < w - 1 &&
            y < h - 1
              ? w + h
              : 0;
      for (let y = 1; y < h; y++)
        for (let x = 1; x < w; x++) {
          const i = y * w + x;
          distance[i] = Math.min(
            distance[i],
            distance[i - 1] + 1,
            distance[i - w] + 1,
          );
        }
      for (let y = h - 2; y >= 0; y--)
        for (let x = w - 2; x >= 0; x--) {
          const i = y * w + x;
          distance[i] = Math.min(
            distance[i],
            distance[i + 1] + 1,
            distance[i + w] + 1,
          );
        }
      let best = 0,
        score = -1;
      for (let i = 0; i < distance.length; i++) {
        // Prefer a broad interior surface, with a modest preference for the
        // upper surface over a similarly broad base. No family-specific points.
        const candidate = distance[i] * (1 + 0.4 * (1 - Math.floor(i / w) / h));
        if (candidate > score) {
          score = candidate;
          best = i;
        }
      }
      if (score <= 0) throw Error("Body has no receiving surface");
      return [
        (((best % w) + 0.5) / w) * width,
        ((Math.floor(best / w) + 0.5) / h) * height,
      ];
    }, source);
    output[source.id] = {
      source_sha256: source.source_sha256,
      contact: source.contact,
      surface,
    };
  }
  writeFileSync(
    "assets/contact-map.json",
    JSON.stringify(output, null, 2) + "\n",
  );
  console.log(
    `Prepared source contact points for ${Object.keys(output).length} variants`,
  );
} finally {
  await browser.close();
}
