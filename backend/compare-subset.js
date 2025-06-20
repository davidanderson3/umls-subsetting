const fs = require('fs');
const path = require('path');
const readline = require('readline');

const metaDir = path.resolve(__dirname, 'META');
const subsetDir = process.argv[2];
const maxDiffLines = 10;

if (!subsetDir) {
    console.error('❌ Usage: node compare-subset.js <subset-folder>');
    process.exit(1);
}

function getRRFfiles(dirPath) {
    return fs.readdirSync(dirPath).filter(f => f.endsWith('.RRF'));
}

function readLinesSet(filePath) {
    return new Promise((resolve) => {
        const lines = new Set();
        const rl = readline.createInterface({
            input: fs.createReadStream(filePath),
            crlfDelay: Infinity,
        });
        rl.on('line', line => lines.add(line));
        rl.on('close', () => resolve(lines));
    });
}

async function compareFileContent(fileName) {
    const metaFile = path.join(metaDir, fileName);
    const subsetFile = path.join(subsetDir, fileName);

    if (!fs.existsSync(metaFile) || !fs.existsSync(subsetFile)) return;

    const [metaLines, subsetLines] = await Promise.all([
        readLinesSet(metaFile),
        readLinesSet(subsetFile)
    ]);

    const onlyInMeta = [...metaLines].filter(line => !subsetLines.has(line));
    const onlyInSubset = [...subsetLines].filter(line => !metaLines.has(line));

    if (onlyInMeta.length === 0 && onlyInSubset.length === 0) {
        console.log(`✅ ${fileName} contents match`);
        return;
    }

    console.log(`\n🔎 Differences in ${fileName}:`);

    if (onlyInMeta.length) {
        console.log(`📉 Lines in META but not in subset (${onlyInMeta.length}):`);
        onlyInMeta.slice(0, maxDiffLines).forEach(l => console.log(`- ${l}`));
        if (onlyInMeta.length > maxDiffLines) {
            console.log(`...and ${onlyInMeta.length - maxDiffLines} more`);
        }
    }

    if (onlyInSubset.length) {
        console.log(`📈 Lines in subset but not in META (${onlyInSubset.length}):`);
        onlyInSubset.slice(0, maxDiffLines).forEach(l => console.log(`+ ${l}`));
        if (onlyInSubset.length > maxDiffLines) {
            console.log(`...and ${onlyInSubset.length - maxDiffLines} more`);
        }
    }
}

async function run() {
    const metaFiles = getRRFfiles(metaDir);
    const subsetFiles = getRRFfiles(subsetDir);
    const commonFiles = metaFiles.filter(f => subsetFiles.includes(f));

    for (const file of commonFiles) {
        await compareFileContent(file);
    }
}

run();
