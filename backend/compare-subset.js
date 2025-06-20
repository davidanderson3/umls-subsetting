const fs = require('fs');
const readline = require('readline');
const path = require('path');

const metaFile = process.argv[2];
const subsetFile = process.argv[3];

if (!metaFile || !subsetFile) {
    console.error('Usage: node compareSortedFiles.js META_sorted/MRCONSO.RRF subset_sorted/MRCONSO.RRF');
    process.exit(1);
}

async function compareSortedFiles(metaPath, subsetPath) {
    const metaStream = readline.createInterface({
        input: fs.createReadStream(metaPath),
        crlfDelay: Infinity
    });

    const subsetStream = readline.createInterface({
        input: fs.createReadStream(subsetPath),
        crlfDelay: Infinity
    });

    const metaIter = metaStream[Symbol.asyncIterator]();
    const subsetIter = subsetStream[Symbol.asyncIterator]();

    let metaLine = (await metaIter.next()).value;
    let subsetLine = (await subsetIter.next()).value;

    const onlyInMeta = [];
    const onlyInSubset = [];

    const writeStreamMeta = fs.createWriteStream(`${metaPath}_only-in-meta.txt`);
    const writeStreamSubset = fs.createWriteStream(`${subsetPath}_only-in-subset.txt`);

    while (metaLine !== undefined || subsetLine !== undefined) {
        if (metaLine === subsetLine) {
            metaLine = (await metaIter.next()).value;
            subsetLine = (await subsetIter.next()).value;
        } else if (subsetLine === undefined || (metaLine !== undefined && metaLine < subsetLine)) {
            writeStreamMeta.write(metaLine + '\n');
            metaLine = (await metaIter.next()).value;
        } else {
            writeStreamSubset.write(subsetLine + '\n');
            subsetLine = (await subsetIter.next()).value;
        }
    }

    writeStreamMeta.end();
    writeStreamSubset.end();

    writeStreamMeta.on('finish', () => console.log(`✅ Done: ${path.basename(metaPath)} → _only-in-meta.txt`));
    writeStreamSubset.on('finish', () => console.log(`✅ Done: ${path.basename(subsetPath)} → _only-in-subset.txt`));
}

compareSortedFiles(metaFile, subsetFile);
