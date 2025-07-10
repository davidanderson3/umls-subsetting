const fs = require('fs');
const path = require('path');
const readline = require('readline');

const otherDir = process.argv[2];
if (!otherDir) {
  console.error('Usage: node sample-cuis.js <A_DIRECTORY>');
  process.exit(1);
}

const metaPath = path.join(__dirname, 'META', 'MRCONSO.RRF');
const otherPath = path.join(otherDir, 'MRCONSO.RRF');
const outputDir = path.join(__dirname, 'samples');
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

async function sampleCuis(filePath, sampleSize) {
  const seen = new Set();
  const sample = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf-8' }),
    crlfDelay: Infinity
  });
  for await (const line of rl) {
    const cui = line.split('|')[0];
    if (seen.has(cui)) continue;
    seen.add(cui);
    if (sample.length < sampleSize) {
      sample.push(cui);
    } else {
      const idx = Math.floor(Math.random() * seen.size);
      if (idx < sampleSize) sample[idx] = cui;
    }
  }
  return sample;
}

async function extractLines(filePath, cuis, outputPath) {
  const cuiSet = new Set(cuis);
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf-8' }),
    crlfDelay: Infinity
  });
  const ws = fs.createWriteStream(outputPath, { encoding: 'utf-8' });
  for await (const line of rl) {
    const cui = line.split('|')[0];
    if (cuiSet.has(cui)) ws.write(line + '\n');
  }
  ws.end();
  await new Promise(resolve => ws.on('finish', resolve));
}

(async () => {
  const sampleSize = 30;
  const cuis = await sampleCuis(metaPath, sampleSize);
  await extractLines(metaPath, cuis, path.join(outputDir, 'META_MRCONSO.RRF'));
  await extractLines(otherPath, cuis, path.join(outputDir, 'A_DIRECTORY_MRCONSO.RRF'));
  console.log('Sampled CUIs saved to', outputDir);
})();
