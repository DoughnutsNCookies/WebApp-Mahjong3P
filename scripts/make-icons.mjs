// Renders the fei tile (飛) into the site's icons: src/app/favicon.ico (16/32/48), icon.png (192) and
// apple-icon.png (180). Rendered with Chromium so the character uses a real CJK font on every device.
// Usage: node scripts/make-icons.mjs

import { writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const tile = (size, round) => `<!doctype html><html><body style="margin:0;background:transparent">
<div style="width:${size}px;height:${size}px;box-sizing:border-box;border-radius:${round}px;
  background:#fffdf7;border:${Math.max(1, Math.round(size / 24))}px solid #b4a88f;
  display:flex;align-items:center;justify-content:center;
  font:700 ${Math.round(size * 0.74)}px 'Microsoft JhengHei','Microsoft YaHei','PingFang TC','Noto Sans CJK TC',sans-serif;
  color:#b4561b;line-height:1">飛</div></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
async function png(size, round, transparent = true) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(tile(size, round));
  return page.screenshot({ omitBackground: transparent, clip: { x: 0, y: 0, width: size, height: size } });
}

// iOS draws its own rounded corners and doesn't like transparency, so the Apple icon is square and opaque.
await writeFile('src/app/apple-icon.png', await png(180, 0, false));
await writeFile('src/app/icon.png', await png(192, 36));

// An .ico file holding PNG images (supported by every current browser).
const images = [];
for (const s of [16, 32, 48]) images.push({ size: s, data: await png(s, Math.round(s / 6)) });
const header = Buffer.alloc(6 + 16 * images.length);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2); // icon
header.writeUInt16LE(images.length, 4);
let offset = header.length;
images.forEach((img, i) => {
  const e = 6 + 16 * i;
  header.writeUInt8(img.size, e);
  header.writeUInt8(img.size, e + 1);
  header.writeUInt16LE(1, e + 4); // colour planes
  header.writeUInt16LE(32, e + 6); // bits per pixel
  header.writeUInt32LE(img.data.length, e + 8);
  header.writeUInt32LE(offset, e + 12);
  offset += img.data.length;
});
await writeFile('src/app/favicon.ico', Buffer.concat([header, ...images.map((i) => i.data)]));
await browser.close();
console.log('wrote src/app/favicon.ico, icon.png, apple-icon.png');
