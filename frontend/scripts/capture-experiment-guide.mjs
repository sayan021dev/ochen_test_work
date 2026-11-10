// Native screenshots of the actual editor. Run with the local API/Vite servers running.
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
const catalog = JSON.parse(readFileSync('../assets/catalog.json', 'utf8'));
const scene = { version: 1, title: 'Мастерская света', format: 'landscape', detail: 'L', scale: .25, palette: catalog.palettes[0], transparent: false, elements: [
  { id: 'guide-lamp', family: 'lamp', role: 'main', x: 500, y: 70, angle: 0, hidden: false, locked: false },
], light: { enabled: false, x: 750, y: 100, height: 1600, opacity: .35 } };
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 850 }, deviceScaleFactor: 1 });
await page.context().addCookies([{ name:'ochen_welcome_seen', value:'1', url:'http://127.0.0.1:5178' }]);
await page.route('**/api/projects/guide-capture', route => route.fulfill({ json: { id: 'guide-capture', scene, revision: 1, updated_at: '2026-11-10T00:00:00Z' } }));
await page.goto('http://127.0.0.1:5178/?project=guide-capture');
await page.getByLabel('Название проекта').waitFor();
await page.getByRole('button', { name:'Открыть эксперимент', exact:true }).click();
await page.getByRole('button', { name:'Закрыть инструкцию' }).click();
await page.evaluate(() => document.fonts.ready);
const clip = { x:600, y:130, width:840, height:500 };
const manifest = {};
async function capture(name, locator) {
  await locator.scrollIntoViewIfNeeded();
  await locator.blur();
  const box = await locator.boundingBox();
  const target = [((box.x + box.width / 2 - clip.x) / clip.width * 100), ((box.y + box.height / 2 - clip.y) / clip.height * 100)].map(n => Math.round(n * 100) / 100);
  await page.screenshot({ path: `public/guide/${name}.png`, clip, animations:'disabled' });
  manifest[name] = { clip, target, control: await locator.getAttribute('aria-label') };
}
await capture('light-enable', page.getByLabel('Общий источник света', { exact:true }));
await page.getByLabel('Общий источник света', { exact:true }).check();
await capture('light-drag', page.getByRole('button', { name:'Источник света', exact:true }));
await capture('light-fields', page.getByLabel('Высота источника', { exact:true }));
await page.getByLabel('Общий источник света', { exact:true }).uncheck();
await page.getByRole('button', { name:'Слой Лампа', exact:true }).click();
await page.getByLabel('Своя тень', { exact:true }).check();
await capture('own-shadow', page.getByLabel('Своя тень', { exact:true }));
writeFileSync('public/guide/capture.json', JSON.stringify({ source: 'Native Playwright screenshots of the local editor, 1440×850, deviceScaleFactor 1', ...manifest }, null, 2)+'\n');
console.log(manifest);
await browser.close();
