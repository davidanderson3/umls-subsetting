const fs = require('fs');
const path = require('path');
const readline = require('readline');

const filesToProcess = [
    'MRCONSO.RRF',
    'MRDEF.RRF',
    'MRRANK.RRF',
    'MRREL.RRF',
    'MRSAB.RRF',
    'MRSAT.RRF'
];

// Index of SAB column in each RRF file type
const sabColumnIndex = {
    'MRCONSO.RRF': 11,
    'MRDEF.RRF': 4,
    'MRRANK.RRF': 1,
    'MRREL.RRF': 10,
    'MRSAB.RRF': 3,
    'MRSAT.RRF': 9
};

async function splitBySAB(inputPath, outputBase) {
    const fileName = path.basename(inputPath);
    const sabIndex = sabColumnIndex[fileName];
    const outputDir = path.join(outputBase, fileName.replace('.RRF', ''));

    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const handles = new Map();

    const rl = readline.createInterface({
        input: fs.createReadStream(inputPath, { encoding: 'utf-8' }),
        crlfDelay: Infinity
    });

    for await (const line of rl) {
        const cols = line.split('|');
        if (cols.length <= sabIndex) continue;
        const sab = cols[sabIndex];
        if (!sab) continue;

        if (!handles.has(sab)) {
            const outPath = path.join(outputDir, `${sab}.txt`);
            handles.set(sab, fs.createWriteStream(outPath, { flags: 'w' }));
        }
        handles.get(sab).write(line + '\n');
    }

    for (const stream of handles.values()) stream.end();
}

async function runAll() {
    const inputDir = path.resolve('./META'); // now using the META folder
    const outputDir = path.resolve('./preprocessed');

    for (const file of filesToProcess) {
        const fullPath = path.join(inputDir, file);
        if (!fs.existsSync(fullPath)) {
            console.warn(`⚠️ Skipping ${file}: not found.`);
            continue;
        }
        console.log(`📂 Processing ${file}`);
        await splitBySAB(fullPath, outputDir);
    }

    console.log('✅ Done.');
}

runAll().catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
});
