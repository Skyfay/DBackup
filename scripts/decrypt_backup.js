const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

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
    console.error('                   Default: removes .enc extension or appends .dec');
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

// Determine output filename
let outputFile = args[2];
if (!outputFile) {
    if (inputFile.endsWith('.enc')) {
        outputFile = inputFile.substring(0, inputFile.length - 4);
    } else {
        outputFile = inputFile + '.dec';
    }
}

// Validate Key
if (hexKey.length !== 64) {
    console.error('Error: Key must be a 64-character hex string (32 bytes).');
    process.exit(1);
}

try {
    const metaContent = fs.readFileSync(metaFile, 'utf8');
    const meta = JSON.parse(metaContent);

    if (!meta.encryption || !meta.encryption.iv || !meta.encryption.authTag) {
        console.error('Error: valid encryption metadata (iv, authTag) not found in .meta.json');
        process.exit(1);
    }

    console.log('Starting decryption...');
    console.log(`Input:  ${inputFile}`);
    console.log(`Meta:   ${metaFile}`);
    console.log(`Output: ${outputFile}`);

    const masterKey = Buffer.from(hexKey, 'hex');
    const iv = Buffer.from(meta.encryption.iv, 'hex');
    const authTag = Buffer.from(meta.encryption.authTag, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, iv);
    decipher.setAuthTag(authTag);

    const input = fs.createReadStream(inputFile);
    const output = fs.createWriteStream(outputFile);

    input.pipe(decipher).pipe(output);

    output.on('finish', () => {
        console.log('Decryption successful! ✅');
    });

    decipher.on('error', (err) => {
        console.error('Decryption failed! ❌');
        console.error('Common causes: Wrong key, corrupted file, or modified metadata.');
        console.error('Details:', err.message);
        // Clean up partial file
        fs.unlink(outputFile, () => {});
        process.exit(1);
    });

} catch (err) {
    console.error('Unexpected error:', err.message);
    process.exit(1);
}
