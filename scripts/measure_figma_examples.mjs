// Native SVG pixel comparison. No page/network/API/provider dependency.
import { chromium } from '../frontend/node_modules/playwright-core/index.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const directory = resolve(process.argv[2] || 'examples/figma-reference');
const manifest = JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8'));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  const results = [];
  for (const example of manifest.examples) {
    const paths = [example.reference, example.replay, ...example.variants.L, ...example.variants.S];
    const sources = await Promise.all(paths.map(path => readFile(resolve(directory, path), 'utf8')));
    const metrics = await page.evaluate(async ({ sources, size }) => {
      const scale = 320 / Math.max(...size);
      const width = Math.round(size[0] * scale), height = Math.round(size[1] * scale);
      const render = async source => {
        const svg = new DOMParser().parseFromString(source, 'image/svg+xml').documentElement;
        svg.setAttribute('width', String(width)); svg.setAttribute('height', String(height));
        const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob), image = new Image();
        image.src = url; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
        const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
        URL.revokeObjectURL(url);
        return context.getImageData(0, 0, width, height).data;
      };
      const pixels = await Promise.all(sources.map(render));
      const background = [215, 205, 245];
      return pixels.slice(1).map(current => {
        let changed = 0, totalError = 0, foregroundUnion = 0, foregroundIntersection = 0;
        for (let i = 0; i < current.length; i += 4) {
          const error = [0, 1, 2, 3].map(k => Math.abs(current[i + k] - pixels[0][i + k]));
          if (Math.max(...error) > 16) changed++;
          totalError += error[0] + error[1] + error[2];
          const refInk = [0, 1, 2].some(k => Math.abs(pixels[0][i + k] - background[k]) > 12);
          const currentInk = [0, 1, 2].some(k => Math.abs(current[i + k] - background[k]) > 12);
          if (refInk || currentInk) foregroundUnion++;
          if (refInk && currentInk) foregroundIntersection++;
        }
        return { width, height, changed_pixels: changed,
          changed_percent: +(changed / (width * height) * 100).toFixed(3),
          mean_rgb_absolute_error: +(totalError / (width * height * 3)).toFixed(4),
          foreground_iou: +(foregroundIntersection / Math.max(1, foregroundUnion)).toFixed(4) };
      });
    }, { sources, size: example.size });
    results.push({ id: example.id, replay: metrics[0],
      L: metrics.slice(1, 4).map((measurement, i) => ({ variant: i + 1, ...measurement })),
      S: metrics.slice(4, 7).map((measurement, i) => ({ variant: i + 1, ...measurement })) });
  }
  const summary = {
    reference_count: results.length, algorithm_count: results.length * 6,
    provider_calls: 0, raster_max_dimension: 320,
    mismatch_threshold: 'RGBA difference >16/255; foreground difference from #D7CDF5 >12/255',
    exact_algorithm_matches: results.flatMap(r => [...r.L, ...r.S]).filter(m => m.changed_pixels === 0).length,
    exact_replay_matches: results.filter(r => r.replay.changed_pixels === 0).length,
    note: 'Diagnostic raster measurement only; deliverable compositions remain editable SVG.',
    examples: results,
  };
  await writeFile(resolve(directory, 'metrics.json'), JSON.stringify(summary, null, 2) + '\n');
  await page.setViewportSize({ width: 1536, height: 3000 });
  await page.goto(pathToFileURL(resolve(directory, 'index.html')).href);
  await page.locator('img').last().waitFor();
  await page.screenshot({ path: resolve(directory, 'overview.png') });
  console.log(JSON.stringify({ references: summary.reference_count, algorithms: summary.algorithm_count,
    exactAlgorithmMatches: summary.exact_algorithm_matches, exactReplayMatches: summary.exact_replay_matches,
    bestAlgorithmChangedPercent: Math.min(...results.flatMap(r => [...r.L, ...r.S]).map(m => m.changed_percent)),
    worstAlgorithmChangedPercent: Math.max(...results.flatMap(r => [...r.L, ...r.S]).map(m => m.changed_percent)) }));
} finally { await browser.close(); }
