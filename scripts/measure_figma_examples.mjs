// Native SVG pixel comparison. No page/network/API/provider dependency.
import { chromium } from '../frontend/node_modules/playwright-core/index.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const directory = resolve(process.argv[2] || 'examples/figma-reference');
const manifest = JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8'));
const spatial = process.argv[3]
  ? JSON.parse(await readFile(resolve(process.argv[3]), 'utf8')) : [];
if (manifest.examples[0].spatial && !spatial.length)
  throw new Error('Run compare_figma_examples.py --render to regenerate all descriptive candidates.');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  const results = [];
  for (const example of manifest.examples) {
    const paths = [example.reference, example.replay, ...example.variants.L, ...example.variants.S];
    const candidates = spatial.find(item => item.id === example.id)?.candidates || [];
    const sources = [
      ...await Promise.all(paths.map(path => readFile(resolve(directory, path), 'utf8'))),
      ...candidates.map(candidate => candidate.svg),
    ];
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
    const spatialMetrics = metrics.slice(7).map((measurement, i) => ({
      ...example.spatial.variants[i], ...measurement,
    }));
    const best = [...spatialMetrics].sort((a, b) =>
      a.changed_pixels - b.changed_pixels || a.mean_rgb_absolute_error - b.mean_rgb_absolute_error)[0];
    if (best) {
      const candidate = candidates.find(item => item.variant === best.variant);
      await writeFile(resolve(directory, example.spatial.best), candidate.svg);
      await writeFile(resolve(directory, example.spatial.best.replace(/\.svg$/, '.json')),
        JSON.stringify(candidate.scene, null, 2) + '\n');
      example.spatial.best_variant = best.variant;
      example.spatial.selection_status = 'native_measured';
    }
    results.push({ id: example.id, replay: metrics[0],
      L: metrics.slice(1, 4).map((measurement, i) => ({ variant: i + 1, ...measurement })),
      S: metrics.slice(4, 7).map((measurement, i) => ({ variant: i + 1, ...measurement })),
      spatial: spatialMetrics, spatial_best_variant: best?.variant });
  }
  const summary = {
    reference_count: results.length, algorithm_count: results.length * 6,
    provider_calls: 0, raster_max_dimension: 320,
    mismatch_threshold: 'RGBA difference >16/255; foreground difference from #D7CDF5 >12/255',
    exact_algorithm_matches: results.flatMap(r => [...r.L, ...r.S]).filter(m => m.changed_pixels === 0).length,
    spatial_relation_definition: 'Axial bound centres; behind/on require AABB overlap and z-order; generated on also requires support IDs. Does not prove physical silhouette contact.',
    spatial_algorithm_count: results.flatMap(r => r.spatial).length,
    spatial_exact_algorithm_matches: results.flatMap(r => r.spatial).filter(m => m.changed_pixels === 0).length,
    spatial_relation_cases_passed: results.flatMap(r => r.spatial).filter(m =>
      m.relation_checks.every(check => check.satisfied)).length,
    spatial_role_cases_passed: results.flatMap(r => r.spatial).filter(m => m.desired_roles_satisfied).length,
    spatial_crop_cases_passed: results.flatMap(r => r.spatial).filter(m => m.desired_crop_satisfied).length,
    exact_replay_matches: results.filter(r => r.replay.changed_pixels === 0).length,
    note: 'Diagnostic raster measurement only; deliverable compositions remain editable SVG.',
    examples: results,
  };
  await writeFile(resolve(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  await writeFile(resolve(directory, 'metrics.json'), JSON.stringify(summary, null, 2) + '\n');
  await page.setViewportSize({ width: 1536, height: 3200 });
  await page.goto(pathToFileURL(resolve(directory, 'index.html')).href);
  await page.locator('img').last().waitFor();
  await page.screenshot({ path: resolve(directory, 'overview.png') });
  console.log(JSON.stringify({ references: summary.reference_count, algorithms: summary.algorithm_count,
    spatialAttempts: summary.spatial_algorithm_count, spatialMatches: summary.spatial_exact_algorithm_matches,
    spatialRelationsPassed: summary.spatial_relation_cases_passed, spatialRolesPassed: summary.spatial_role_cases_passed,
    spatialCropPassed: summary.spatial_crop_cases_passed, exactAlgorithmMatches: summary.exact_algorithm_matches, exactReplayMatches: summary.exact_replay_matches,
    bestAlgorithmChangedPercent: Math.min(...results.flatMap(r => [...r.L, ...r.S]).map(m => m.changed_percent)),
    worstAlgorithmChangedPercent: Math.max(...results.flatMap(r => [...r.L, ...r.S]).map(m => m.changed_percent)) }));
} finally { await browser.close(); }
