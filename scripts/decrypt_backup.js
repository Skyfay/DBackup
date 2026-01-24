/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const crypto = require('crypto');
// const path = require('path');
const zlib = require('zlib');

// Usage: node decrypt_backup.js <input_file.enc> <hex_key>
// Or:    node decrypt_backup.js <input_file.enc> <hex_key> <output_file>

const args = process.argv.slice(2);

if (args.length < 2) {
    console.error('Usage: node decrypt_backup.js <input_file.enc> <hex_key> [output_file]');
    console.error('');
    console.error('Arguments:');
    console.error('  input_file.enc   Path to the encrypted backup file');
    console.error('  hex_key          The 64-character hex string exported from the Backup Manager Vault');
    console.error('                   (Can be found in Settings -> Encryption Profiles -> Reveal Key)');
    console.error('  output_file      (Optional) Path for the decrypted output.');
    console.error('                   Default: removes .enc extension, converts .gz/.br if compressed, or appends .dec');
    console.error('');
    console.error('Note: The script expects a .meta.json file next to the .enc file to verify integrity (AuthTag/IV).');
    process.exit(1);
}

const inputFile = args[0];
const hexKey = args[1];

if (!fs.existsSync(inputFile)) {
    console.error(`Error: Input file '${inputFile}' not found.`);
    process.exit(1);
}

const metaFile = inputFile + '.meta.json'; // The sidecar file convention
if (!fs.existsSync(metaFile)) {
    console.error(`Error: Metadata file '${metaFile}' not found.`);
    console.error('The decryption requires the IV and AuthTag stored in the .meta.json sidecar file.');
    process.exit(1);
}

// Read Metadata
let meta;
try {
    const metaContent = fs.readFileSync(metaFile, 'utf8');
    meta = JSON.parse(metaContent);
} catch (err) {
    console.error('Error reading metadata file:', err.message);
    process.exit(1);
}

// Determine compression
const compression = meta.compression || 'NONE';

// Determine output filename
let outputFile = args[2];
if (!outputFile) {
    let tempName = inputFile;
    // 1. Remove .enc
    if (tempName.endsWith('.enc')) {
        tempName = tempName.substring(0, tempName.length - 4);
    } else {
        tempName = tempName + '.dec';
    }

    // 2. Remove compression extension if we are going to decompress
    if (compression === 'GZIP' && tempName.endsWith('.gz')) {
        tempName = tempName.substring(0, tempName.length - 3);
    } else if (compression === 'BROTLI' && tempName.endsWith('.br')) {
        tempName = tempName.substring(0, tempName.length - 3);
    }

    outputFile = tempName;
}

// Validate Key
if (hexKey.length !== 64) {
    console.error('Error: Key must be a 64-character hex string (32 bytes).');
    process.exit(1);
}

try {
    if (!meta.encryption || !meta.encryption.iv || !meta.encryption.authTag) {
        console.error('Error: valid encryption metadata (iv, authTag) not found in .meta.json');
        process.exit(1);
    }

    console.log('Starting processing...');
    console.log(`Input:       ${inputFile}`);
    console.log(`Compression: ${compression}`);
    console.log(`Output:      ${outputFile}`);

    const masterKey = Buffer.from(hexKey, 'hex');
    const iv = Buffer.from(meta.encryption.iv, 'hex');
    const authTag = Buffer.from(meta.encryption.authTag, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, iv);
    decipher.setAuthTag(authTag);

    // Prepare streams
    const input = fs.createReadStream(inputFile);
    const output = fs.createWriteStream(outputFile);

    let pipeline = input.pipe(decipher);

    // Add decompression if needed
    if (compression === 'GZIP') {
        const gunzip = zlib.createGunzip();
        pipeline = pipeline.pipe(gunzip);
    } else if (compression === 'BROTLI') {
        // Node.js < 12 doesn't have brotli, but we assume modern env
        const brotliDecompress = zlib.createBrotliDecompress();
        pipeline = pipeline.pipe(brotliDecompress);
    }

    pipeline.pipe(output);

    output.on('finish', () => {
        console.log('Process completed successfully! ✅');
    });

    // Error handling for all streams is a bit tricky with simple pipes,
    // but we attach listeners to the key components.
    decipher.on('error', (_err) => {
        console.error('Decryption failed! ❌ (Bad key or AuthTag mismatch)');
        cleanup();
    });

    input.on('error', (err) => { console.error('Input Error:', err.message); cleanup(); });
    output.on('error', (err) => { console.error('Output Error:', err.message); cleanup(); });

    function cleanup() {
         try { fs.unlinkSync(outputFile); } catch(_e){}
         process.exit(1);
    }

} catch (err) {
    console.error('Unexpected error:', err.message);
    process.exit(1);
}
