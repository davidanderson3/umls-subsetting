// Full update for subsetting.js with partial subset reuse logic
const fs = require('fs');
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const readline = require('readline');
const archiver = require('archiver');

const app = express();
const port = 3001;

console.log("Starting subsetting server...");

app.use(cors());
app.use(bodyParser.json());

const sourcesFilePath = path.join(__dirname, 'sources.json');
const subsetCacheFile = path.join(__dirname, 'subset-cache.json');
let activeSources = [];
let subsetCache = {};

// Load sources
fs.readFile(sourcesFilePath, 'utf-8', (err, data) => {
  if (!err) {
    try {
      activeSources = JSON.parse(data);
      console.log("Loaded sources.json successfully.");
    } catch (jsonErr) {
      console.error("Error parsing sources.json:", jsonErr);
    }
  }
});

// Load cache
if (fs.existsSync(subsetCacheFile)) {
  try {
    subsetCache = JSON.parse(fs.readFileSync(subsetCacheFile, 'utf-8'));
    console.log('✅ Loaded subset cache from disk.');
  } catch (err) {
    console.error('❌ Failed to parse subset-cache.json:', err);
  }
}

function saveSubsetCacheToDisk() {
  fs.writeFileSync(subsetCacheFile, JSON.stringify(subsetCache, null, 2), 'utf-8');
}

function findBestSubsetReuse(selectedSABs) {
  const selectedSet = new Set(selectedSABs);
  const candidates = Object.entries(subsetCache).filter(([_, entry]) => {
    if (typeof entry !== 'object' || !Array.isArray(entry.sources)) return false;
    return entry.sources.every(sab => selectedSet.has(sab));
  });
  candidates.sort((a, b) => b[1].sources.length - a[1].sources.length);
  return candidates.length > 0 ? candidates[0][1] : null;
}

app.post('/api/saveSources', (req, res) => {
  const sources = req.body;
  activeSources = sources;
  fs.writeFile(sourcesFilePath, JSON.stringify(sources, null, 2), 'utf-8', err => {
    if (err) return res.status(500).send({ message: 'Failed to save sources' });
    res.status(200).send({ message: 'Sources saved successfully' });
  });
});

app.get('/api/getActiveSources', (req, res) => {
  res.status(200).json(activeSources);
});

function concatSABFiles(fileName, selectedSABs, outputPath, stepName, res) {
  return new Promise((resolve) => {
    res.write(`event: step\ndata: ${JSON.stringify({ step: stepName })}\n\n`);
    const writeStream = fs.createWriteStream(outputPath, { flags: 'a', encoding: 'utf-8' });

    let processedFiles = 0;

    const concatNext = (index) => {
      if (index >= selectedSABs.length) {
        writeStream.end(() => {
          res.write(`event: progress\ndata: ${JSON.stringify({
            step: stepName,
            processedFiles,
            totalFiles: selectedSABs.length,
            completed: true
          })}\n\n`);
          resolve();
        });
        return;
      }

      const sab = selectedSABs[index];
      const inputPath = path.join(__dirname, 'preprocessed', fileName.replace('.RRF', ''), `${sab}.txt`);

      if (!fs.existsSync(inputPath)) {
        processedFiles++;
        res.write(`event: progress\ndata: ${JSON.stringify({ step: stepName, processedFiles, totalFiles: selectedSABs.length })}\n\n`);
        return concatNext(index + 1);
      }

      const readStream = fs.createReadStream(inputPath, { encoding: 'utf-8' });
      readStream.pipe(writeStream, { end: false });

      readStream.on('end', () => {
        processedFiles++;
        res.write(`event: progress\ndata: ${JSON.stringify({ step: stepName, processedFiles, totalFiles: selectedSABs.length })}\n\n`);
        concatNext(index + 1);
      });

      readStream.on('error', (err) => {
        console.error(`❌ Error reading ${inputPath}:`, err);
        concatNext(index + 1); // Skip and continue
      });
    };

    concatNext(0);
  });
}

function computePreferences(mrconsoPath, rankPath, outputPath, res) {
  return new Promise((resolve, reject) => {
    res.write(`event: step\ndata: ${JSON.stringify({ step: 'Compute Preferences' })}\n\n`);

    const rankMap = {};
    fs.readFileSync(rankPath, 'utf-8').split('\n').forEach(line => {
      const f = line.split('|');
      if (f.length > 2) rankMap[`${f[0]}|${f[1]}`] = parseInt(f[2]);
    });

    const stream = fs.createReadStream(mrconsoPath, { encoding: 'utf-8', highWaterMark: 64 * 1024 });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    const writeStream = fs.createWriteStream(outputPath, 'utf-8');

    let currentKey = null, currentGroup = [];

    // Simulate progress
    let fakeProgress = 0;
    const simulateProgress = setInterval(() => {
      if (fakeProgress < 99) {
        fakeProgress++;
        res.write(`event: progress\ndata: ${JSON.stringify({
          step: 'Compute Preferences',
          processedFiles: fakeProgress,
          totalFiles: 100
        })}\n\n`);
      }
    }, 250); // ~25 seconds

    const flushGroup = () => {
      if (!currentGroup.length) return;
      currentGroup.sort((a, b) => (rankMap[`${a[11]}|${a[12]}`] || 9999) - (rankMap[`${b[11]}|${b[12]}`] || 9999));
      const preferredTTY = currentGroup[0][12];
      currentGroup.forEach((f, i) => {
        f[2] = i === 0 ? 'P' : 'N';
        f[6] = i === 0 ? 'Y' : 'N';
        f[4] = f[12] === preferredTTY ? 'PF' : (['SY', 'ET'].includes(f[12]) ? 'SY' : (['AC', 'AT', 'AB'].includes(f[12]) ? 'AC' : 'VC'));
        writeStream.write(f.join('|') + '|\n');
      });
      currentGroup = [];
    };

    rl.on('line', line => {
      const f = line.split('|');
      const key = `${f[0]}|${f[11]}`;
      if (currentKey !== null && key !== currentKey) flushGroup();
      currentKey = key;
      currentGroup.push(f);
    });

    rl.on('close', () => {
      flushGroup();
      writeStream.end(() => {
        clearInterval(simulateProgress);
        res.write(`event: progress\ndata: ${JSON.stringify({
          step: 'Compute Preferences',
          processedFiles: 100,
          totalFiles: 100,
          completed: true
        })}\n\n`);
        resolve();
      });
    });

    rl.on('error', (err) => {
      clearInterval(simulateProgress);
      reject(err);
    });
  });
}


function countLinesInFile(filePath) {
  return new Promise((resolve, reject) => {
    let count = 0;
    const stream = fs.createReadStream(filePath, { highWaterMark: 64 * 1024 });
    readline.createInterface({ input: stream, crlfDelay: Infinity })

      .on('line', () => count++)
      .on('close', () => resolve(count))
      .on('error', reject);
  });
}

const createCompressedTarFile = (folderPath, tarGzPath, res) => {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(tarGzPath);
    const archive = archiver('tar', {
      gzip: true,
      gzipOptions: { level: 1 } // you can tune this (1 = fast, 9 = best)
    });

    let fakeProgress = 0;
    const step = 'Zipping';

    res.write(`event: step\ndata: ${JSON.stringify({ step })}\n\n`);

    archive.on('error', reject);

    const progressInterval = setInterval(() => {
      if (fakeProgress < 99) {
        fakeProgress++;
        res.write(`event: progress\ndata: ${JSON.stringify({
          step,
          processedFiles: fakeProgress,
          totalFiles: 100
        })}\n\n`);
      }
    }, 1212);

    output.on('close', () => {
      clearInterval(progressInterval);
      res.write(`event: progress\ndata: ${JSON.stringify({
        step,
        processedFiles: 100,
        totalFiles: 100,
        completed: true
      })}\n\n`);
      resolve();
    });

    archive.pipe(output);

    fs.readdirSync(folderPath)
      .filter(f => f.endsWith('.RRF'))
      .forEach(file => {
        archive.file(path.join(folderPath, file), { name: file });
      });

    archive.finalize();
  });
};


app.get('/api/subsetMetathesaurusProgress', async (req, res) => {
  const selectedSourceAbbreviations = req.query.selectedSourceAbbreviations?.split(',') || [];
  const key = selectedSourceAbbreviations.sort().join(',');
  const entry = subsetCache[key];
  if (entry && fs.existsSync(path.join(__dirname, entry.folder, `${entry.folder}.zip`))) {
    console.log(`✅ Exact subset match found: ${key} → ${entry.folder}`);

    const steps = ['MRSAB', 'MRRANK', 'MRDEF', 'MRREL', 'MRSAT', 'MRCONSO', 'Compute Preferences', 'Zipping'];

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    for (const step of steps) {
      res.write(`event: step\ndata: ${JSON.stringify({ step })}\n\n`);
      res.write(`event: progress\ndata: ${JSON.stringify({ step, processedFiles: 100, totalFiles: 100, completed: true })}\n\n`);
    }

    // Generate fresh folder name
    const requestId = new Date().toISOString().replace(/[:.]/g, '-');
    const aliasFolder = `META_${requestId}`;
    const aliasPath = path.join(__dirname, aliasFolder);
    const aliasZipPath = path.join(aliasPath, `${aliasFolder}.zip`);
    const originalZipPath = path.join(__dirname, entry.folder, `${entry.folder}.zip`);

    try {
      // Create new alias folder
      fs.mkdirSync(aliasPath, { recursive: true });

      // Symlink the zip file into that folder using the expected name
      fs.symlinkSync(originalZipPath, aliasZipPath);

      res.write(`event: complete\ndata: ${JSON.stringify({
        folder: aliasFolder,
        zipFile: aliasZipPath,
        requestId
      })}\n\n`);
    } catch (err) {
      console.error('❌ Failed to create alias folder or symlink:', err);
      res.write(`event: error\ndata: ${JSON.stringify({ step: 'Zipping', error: err.message })}\n\n`);
    }

    res.end();
    return;
  }


  if (selectedSourceAbbreviations.length === 0) {
    res.status(400).json({ error: 'selectedSourceAbbreviations query parameter is required' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const folderName = `META_${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const folderPath = path.join(__dirname, folderName);
  fs.mkdirSync(folderPath, { recursive: true });

  const rankPath = path.join(folderPath, 'MRRANK.RRF');
  const inputPath = path.join(folderPath, 'MRCONSO.RRF');
  const tempOutputPath = path.join(folderPath, 'MRCONSO.processed.RRF');
  const zipFilePath = path.join(folderPath, `${folderName}.zip`);

  const bestMatch = findBestSubsetReuse(selectedSourceAbbreviations);
  const reusedFolder = bestMatch?.folder;
  const reusedSources = new Set(bestMatch?.sources || []);

  const extraSources = selectedSourceAbbreviations.filter(s => !reusedSources.has(s));

  async function reuseFile(fileName) {
    if (!reusedFolder) return;
    const existing = path.join(__dirname, reusedFolder, fileName);
    const out = path.join(folderPath, fileName);
    if (fs.existsSync(existing)) {
      if (fs.existsSync(existing)) {
        fs.copyFileSync(existing, out);
      }

    }
  }

  try {
    // Reuse and extend
    await reuseFile('MRRANK.RRF');
    await reuseFile('MRCONSO.RRF');

    const shouldDelayOthers = extraSources.length > 20;
    const maybeDelay = (fn) =>
      shouldDelayOthers
        ? new Promise(resolve => setTimeout(() => fn().then(resolve), 5000))
        : fn();

    // Start lower-priority tasks with optional delay
    const relTask = maybeDelay(() => reuseFile('MRREL.RRF').then(() =>
      concatSABFiles('MRREL.RRF', extraSources, path.join(folderPath, 'MRREL.RRF'), 'MRREL', res)
    ));
    const satTask = maybeDelay(() => reuseFile('MRSAT.RRF').then(() =>
      concatSABFiles('MRSAT.RRF', extraSources, path.join(folderPath, 'MRSAT.RRF'), 'MRSAT', res)
    ));
    const defTask = maybeDelay(() => reuseFile('MRDEF.RRF').then(() =>
      concatSABFiles('MRDEF.RRF', extraSources, path.join(folderPath, 'MRDEF.RRF'), 'MRDEF', res)
    ));
    const sabTask = maybeDelay(() => reuseFile('MRSAB.RRF').then(() =>
      concatSABFiles('MRSAB.RRF', extraSources, path.join(folderPath, 'MRSAB.RRF'), 'MRSAB', res)
    ));

    // Step 2: Rank + MRCONSO + Preferences (sequential)
    await concatSABFiles('MRRANK.RRF', extraSources, rankPath, 'MRRANK', res);

    console.log('🔁 Starting MRCONSO concat...');
    await concatSABFiles('MRCONSO.RRF', extraSources, inputPath, 'MRCONSO', res);
    console.log('✅ MRCONSO concat done.');

    console.log('⚙️ Starting computePreferences...');

    // Just run computePreferences — it now handles its own progress
    await computePreferences(inputPath, rankPath, tempOutputPath, res);


    // Replace original file with processed one
    fs.renameSync(tempOutputPath, inputPath);
    console.log('✅ computePreferences complete.');



    // Step 3: Wait for parallel tasks
    await Promise.all([relTask, satTask, defTask, sabTask]);

    const tarGzPath = path.join(folderPath, `${folderName}.tar.gz`);
    await createCompressedTarFile(folderPath, tarGzPath, res);


    subsetCache[key] = {
      folder: folderName,
      sources: selectedSourceAbbreviations.sort()
    };
    saveSubsetCacheToDisk();

    res.write(`event: complete\ndata: ${JSON.stringify({ folder: folderName, zipFile: tarGzPath })}\n\n`);
    res.end();
  } catch (err) {
    console.error("❌ Subsetting error:", err);
    res.write(`event: error\ndata: ${JSON.stringify({ step: 'Subsetting', error: err.message })}\n\n`);
    res.end();
  }
});

app.get('/:folder/:file', (req, res) => {
  const zipPath = path.join(__dirname, req.params.folder, req.params.file);
  if (fs.existsSync(zipPath)) res.sendFile(zipPath);
  else res.status(404).send('File not found');
});

app.listen(port, () => console.log(`🚀 Server is running at http://localhost:${port}`));
