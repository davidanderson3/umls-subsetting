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
        }, 250);

        const flushGroup = () => {
            if (!currentGroup.length) return;
            currentGroup.sort((a, b) =>
                (rankMap[`${a[11]}|${a[12]}`] || 9999) - (rankMap[`${b[11]}|${b[12]}`] || 9999)
            );
            const preferredTTY = currentGroup[0][12];
            currentGroup.forEach((f, i) => {
                if (i === 0) {
                    f[2] = 'P'; // TS
                    f[6] = 'Y'; // ISPREF
                    f[4] = 'PF'; // STT
                }
                // For non-preferred atoms, preserve original TS, ISPREF, STT
                writeStream.write(f.join('|') + '|\n');
            });
            currentGroup = [];
        };

        rl.on('line', line => {
            const f = line.split('|');
            const key = `${f[0]}|${f[1]}|${f[11]}`;  // CUI|LAT|SAB for correct grouping
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

function subsetMRSTY(sourcePath, mrconsoPath, outputPath, res) {
    return new Promise((resolve, reject) => {
        res.write(`event: step\ndata: ${JSON.stringify({ step: 'MRSTY' })}\n\n`);

        const cuis = new Set();
        readline
            .createInterface({ input: fs.createReadStream(mrconsoPath, 'utf-8'), crlfDelay: Infinity })
            .on('line', line => {
                const f = line.split('|');
                if (f.length > 0) cuis.add(f[0]);
            })
            .on('close', () => {
                const rl = readline.createInterface({ input: fs.createReadStream(sourcePath, 'utf-8'), crlfDelay: Infinity });
                const ws = fs.createWriteStream(outputPath, 'utf-8');
                let processedLines = 0;
                rl.on('line', line => {
                    processedLines++;
                    if (processedLines % 50000 === 0) {
                        res.write(`event: progress\ndata: ${JSON.stringify({ step: 'MRSTY', totalLines: processedLines })}\n\n`);
                    }
                    const cui = line.split('|')[0];
                    if (cuis.has(cui)) ws.write(line + '\n');
                });
                rl.on('close', () => {
                    ws.end(() => {
                        res.write(`event: progress\ndata: ${JSON.stringify({ step: 'MRSTY', totalLines: processedLines, completed: true })}\n\n`);
                        resolve();
                    });
                });
                rl.on('error', reject);
            })
            .on('error', reject);
    });
}

function copyMRDOC(destFolder, res) {
    return new Promise((resolve) => {
        const step = "MRDOC";
        res.write(`event: step\ndata: ${JSON.stringify({ step })}\n\n`);
        const src = path.join(__dirname, "META", "MRDOC.RRF");
        const dest = path.join(destFolder, "MRDOC.RRF");
        if (fs.existsSync(src)) fs.copyFileSync(src, dest);
        res.write(`event: progress\ndata: ${JSON.stringify({ step, processedFiles: 100, totalFiles: 100, completed: true })}\n\n`);
        resolve();
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
        const step = 'Compressing';

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
    const selectedSourceAbbreviations = (req.query.selectedSourceAbbreviations || '').split(',').filter(Boolean);
    const key = selectedSourceAbbreviations.sort().join(',');
    const entry = subsetCache[key];

    // 1) Cache‐hit path: reuse existing .tar.gz
    if (entry) {
        const tarGzName = `${entry.folder}.tar.gz`;
        const originalTarGz = path.join(__dirname, entry.folder, tarGzName);

        if (fs.existsSync(originalTarGz)) {
            console.log(`✅ Exact subset match found: ${key} → ${entry.folder}`);

            // — Send SSE headers
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.flushHeaders();

            // — Emit each step as already complete
            const steps = [
                'MRSAB',
                'MRRANK',
                'MRDEF',
                'MRREL',
                'MRSAT',
                'MRDOC',
                'MRCONSO',
                'Compute Preferences',
                'Compressing'
            ];
            for (const step of steps) {
                res.write(`event: step\ndata: ${JSON.stringify({ step })}\n\n`);
                res.write(`event: progress\ndata: ${JSON.stringify({
                    step,
                    processedFiles: 100,
                    totalFiles: 100,
                    completed: true
                })}\n\n`);
            }

            // — Symlink into a fresh alias folder
            const requestId = new Date().toISOString().replace(/[:.]/g, '-');
            const aliasFolder = `META_${requestId}`;
            const aliasPath = path.join(__dirname, aliasFolder);
            const aliasTarGz = path.join(aliasPath, tarGzName);

            fs.mkdirSync(aliasPath, { recursive: true });
            fs.symlinkSync(originalTarGz, aliasTarGz);

            // — Notify client and end
            res.write(`event: complete\ndata: ${JSON.stringify({
                folder: aliasFolder,
                tarFile: aliasTarGz,
                requestId
            })}\n\n`);
            res.end();
            return;
        }
    }

    // 2) Validate input
    if (selectedSourceAbbreviations.length === 0) {
        return res.status(400).json({ error: 'selectedSourceAbbreviations query parameter is required' });
    }

    // — Send SSE headers for full recompute
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // 3) Prepare new folder
    const folderName = `META_${new Date().toISOString().replace(/[:.]/g, '-')}`;
    const folderPath = path.join(__dirname, folderName);
    fs.mkdirSync(folderPath, { recursive: true });

    const rankPath = path.join(folderPath, 'MRRANK.RRF');
    const inputPath = path.join(folderPath, 'MRCONSO.RRF');
    const tempOutputPath = path.join(folderPath, 'MRCONSO.processed.RRF');
    const tarGzPath = path.join(folderPath, `${folderName}.tar.gz`);

    // 4) Determine reuse vs. extras
    const bestMatch = findBestSubsetReuse(selectedSourceAbbreviations);
    const reusedFolder = bestMatch?.folder;
    const reusedSet = new Set(bestMatch?.sources || []);
    const extraSources = selectedSourceAbbreviations.filter(sab => !reusedSet.has(sab));

    async function reuseFile(fileName) {
        if (!reusedFolder) return;
        const existing = path.join(__dirname, reusedFolder, fileName);
        const out = path.join(folderPath, fileName);
        if (fs.existsSync(existing)) fs.copyFileSync(existing, out);
    }

    try {
        // 5) Reuse MR files if available
        await reuseFile('MRRANK.RRF');
        await reuseFile('MRCONSO.RRF');
        await reuseFile('MRSTY.RRF');
        await reuseFile('MRDOC.RRF');

        // 6) Kick off parallel SAB concats (with optional delay)
        const shouldDelay = extraSources.length > 20;
        const maybeDelay = fn =>
            shouldDelay
                ? new Promise(resolve => setTimeout(() => fn().then(resolve), 5000))
                : fn();

        const relTask = maybeDelay(() =>
            reuseFile('MRREL.RRF').then(() =>
                concatSABFiles('MRREL.RRF', extraSources, path.join(folderPath, 'MRREL.RRF'), 'MRREL', res)
            )
        );
        const satTask = maybeDelay(() =>
            reuseFile('MRSAT.RRF').then(() =>
                concatSABFiles('MRSAT.RRF', extraSources, path.join(folderPath, 'MRSAT.RRF'), 'MRSAT', res)
            )
        );
        const defTask = maybeDelay(() =>
            reuseFile('MRDEF.RRF').then(() =>
                concatSABFiles('MRDEF.RRF', extraSources, path.join(folderPath, 'MRDEF.RRF'), 'MRDEF', res)
            )
        );
        const sabTask = maybeDelay(() =>
            reuseFile('MRSAB.RRF').then(() =>
                concatSABFiles('MRSAB.RRF', extraSources, path.join(folderPath, 'MRSAB.RRF'), 'MRSAB', res)
            )
        );

        // 7) Sequential: RANK → CONSO → Preferences
        await concatSABFiles('MRRANK.RRF', extraSources, rankPath, 'MRRANK', res);

        console.log('🔁 Starting MRCONSO concat…');
        await concatSABFiles('MRCONSO.RRF', extraSources, inputPath, 'MRCONSO', res);
        console.log('✅ MRCONSO concat done.');

        console.log('⚙️ Starting computePreferences…');
        await computePreferences(inputPath, rankPath, tempOutputPath, res);
        fs.renameSync(tempOutputPath, inputPath);
        console.log('✅ computePreferences complete.');

        // Send MRCONSO line count for downstream progress calculations
        try {
            const mrconsoLines = await countLinesInFile(inputPath);
            res.write(`event: progress\ndata: ${JSON.stringify({ step: 'MRCONSO', totalLines: mrconsoLines })}\n\n`);
        } catch (countErr) {
            console.error('❌ Failed to count MRCONSO lines:', countErr);
        }

        console.log('📄 Starting MRSTY subset…');
        await subsetMRSTY(path.join(__dirname, 'META', 'MRSTY.RRF'), inputPath, path.join(folderPath, 'MRSTY.RRF'), res);
        console.log('✅ MRSTY subset complete.');

        // 8) Wait for SAB tasks
        await Promise.all([relTask, satTask, defTask, sabTask]);

        // 9) Copy MRDOC
        console.log('📋 Copying MRDOC…');
        await copyMRDOC(folderPath, res);
        console.log('✅ MRDOC copy complete.');

        // 10) Create final .tar.gz
        await createCompressedTarFile(folderPath, tarGzPath, res);

        // 11) Update cache
        subsetCache[key] = {
            folder: folderName,
            sources: selectedSourceAbbreviations.sort()
        };
        saveSubsetCacheToDisk();

        // 12) Finish
        res.write(`event: complete\ndata: ${JSON.stringify({
            folder: folderName,
            tarFile: tarGzPath
        })}\n\n`);
        res.end();
    } catch (err) {
        console.error('❌ Subsetting error:', err);
        res.write(`event: error\ndata: ${JSON.stringify({
            step: 'Subsetting',
            error: err.message
        })}\n\n`);
        res.end();
    }
});


app.get('/:folder/:file', (req, res) => {
    const zipPath = path.join(__dirname, req.params.folder, req.params.file);
    if (fs.existsSync(zipPath)) res.sendFile(zipPath);
    else res.status(404).send('File not found');
});

app.listen(port, () => console.log(`🚀 Server is running at http://localhost:${port}`));
