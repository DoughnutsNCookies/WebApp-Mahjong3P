// Checks the web AI against PyTorch: the same moves on the test positions written by export_web.py.
// Usage: npx tsx scripts/ai-check.ts [training/runs/webcheck.bin]

import { readFileSync } from 'node:fs';
import { bestSlot, forward, parseModel, WEB_MODEL } from '../src/ai/web';

const file = readFileSync(process.argv[2] ?? 'training/runs/webcheck.bin');
const buf = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
const [n, obsSize, actions] = new Int32Array(buf, 0, 3);
const obs = new Float32Array(buf, 12, n * obsSize);
const mask = new Uint8Array(buf, 12 + n * obsSize * 4, n * actions);
const moves = new Int32Array(buf.slice(12 + n * obsSize * 4 + n * actions));

const weights = readFileSync(`public/ai/${WEB_MODEL.file}`);
const model = parseModel(weights.buffer.slice(weights.byteOffset, weights.byteOffset + weights.byteLength));
if (model.obs !== obsSize) throw new Error(`Model expects ${model.obs} inputs, test positions have ${obsSize}`);

let same = 0;
let choices = 0;
const t0 = Date.now();
for (let i = 0; i < n; i++) {
  const m = mask.subarray(i * actions, (i + 1) * actions);
  if (m.reduce((a, x) => a + x, 0) < 2) continue; // only one legal move: nothing to check
  choices++;
  if (bestSlot(forward(model, obs.subarray(i * obsSize, (i + 1) * obsSize)), m) === moves[i]) same++;
}
const ms = (Date.now() - t0) / n;
console.log(`${WEB_MODEL.name} (${WEB_MODEL.source}): same move as PyTorch in ${same} of ${choices} real choices ` +
  `(${((100 * same) / choices).toFixed(2)}%), ${ms.toFixed(2)} ms per move`);
