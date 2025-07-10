const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync } = require('child_process');
const Diff2Html = require('diff2html');

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

async function extractLines(filePath, cuis) {
  const cuiSet = new Set(cuis);
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf-8' }),
    crlfDelay: Infinity
  });
  const lines = [];
  for await (const line of rl) {
    const cui = line.split('|')[0];
    if (cuiSet.has(cui)) lines.push(line);
  }
  return lines;
}

(async () => {
  const sampleSize = 30;
  const cuis = await sampleCuis(metaPath, sampleSize);

  const metaLines = await extractLines(metaPath, cuis);
  const otherLines = await extractLines(otherPath, cuis);

  function filterMatchingAuis(meta, other) {
    const metaMap = new Map();
    for (const line of meta) {
      const aui = line.split('|')[7];
      metaMap.set(aui, line);
    }
    const otherMap = new Map();
    for (const line of other) {
      const aui = line.split('|')[7];
      otherMap.set(aui, line);
    }
    const metaFiltered = [];
    const otherFiltered = [];
    for (const [aui, line] of metaMap.entries()) {
      if (otherMap.has(aui)) {
        metaFiltered.push(line);
        otherFiltered.push(otherMap.get(aui));
      }
    }
    return [metaFiltered, otherFiltered, metaMap, otherMap];
  }

  const [metaFiltered, otherFiltered, metaMap, otherMap] = filterMatchingAuis(metaLines, otherLines);

  function compareByCuiAui(a, b) {
    const fieldsA = a.split('|');
    const fieldsB = b.split('|');
    const cuiCompare = fieldsA[0].localeCompare(fieldsB[0]);
    if (cuiCompare !== 0) return cuiCompare;
    return fieldsA[7].localeCompare(fieldsB[7]);
  }

  metaFiltered.sort(compareByCuiAui);
  otherFiltered.sort(compareByCuiAui);

  const metaFile = path.join(outputDir, 'META_MRCONSO.RRF');
  const otherFile = path.join(outputDir, 'A_DIRECTORY_MRCONSO.RRF');

  fs.writeFileSync(metaFile, metaFiltered.join('\n') + '\n', 'utf-8');
  fs.writeFileSync(otherFile, otherFiltered.join('\n') + '\n', 'utf-8');

  let diffOutput = '';
  try {
    diffOutput = execSync(`diff -u ${metaFile} ${otherFile}`, { encoding: 'utf-8' });
  } catch (err) {
    diffOutput = err.stdout || '';
  }

  const diffFile = path.join(outputDir, 'diff.txt');
  fs.writeFileSync(diffFile, diffOutput, 'utf-8');

  // === Non-matching atoms summary ===
  const nonMatchingMeta = [...metaMap.keys()].filter(aui => !otherMap.has(aui));
  const nonMatchingOther = [...otherMap.keys()].filter(aui => !metaMap.has(aui));

  const nonMatchSummary = [
    '\n\n=== Non-matching AUIs ===\n',
    `In META but not in OTHER: ${nonMatchingMeta.length ? nonMatchingMeta.join(', ') : 'None'}`,
    `In OTHER but not in META: ${nonMatchingOther.length ? nonMatchingOther.join(', ') : 'None'}`
  ].join('\n');

  fs.appendFileSync(diffFile, nonMatchSummary, 'utf-8');

  const diffHtml = Diff2Html.html(Diff2Html.parse(diffOutput), {
    drawFileList: true,
    matching: 'lines',
    outputFormat: 'side-by-side'
  });

  const htmlFile = path.join(outputDir, 'diff.html');
  const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/diff2html/bundles/css/diff2html.min.css">
  <style>
    pre { white-space: pre-wrap; word-break: break-word; }
    .non-matching { padding: 1em; background-color: #f9f9f9; border-top: 1px solid #ccc; }
  </style>
</head>
<body>
${diffHtml}
<div class="non-matching">
  <h3>Non-matching AUIs</h3>
  <pre>
In META but not in OTHER:
${nonMatchingMeta.length ? nonMatchingMeta.join(', ') : 'None'}

In OTHER but not in META:
${nonMatchingOther.length ? nonMatchingOther.join(', ') : 'None'}
  </pre>
</div>
</body>
</html>`;
  fs.writeFileSync(htmlFile, htmlContent, 'utf-8');

  console.log('Sampled CUIs saved to', outputDir);
  console.log('Diff written to', diffFile);
  console.log('HTML diff written to', htmlFile);
})();
