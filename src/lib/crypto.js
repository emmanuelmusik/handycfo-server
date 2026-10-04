import crypto from 'node:crypto';

// Dropbox access/refresh tokens are as sensitive as a password —
// they're encrypted before they ever reach the database, so a
// leaked DB export doesn't hand over live access to someone's
// Dropbox. AES-256-GCM gives us both encryption and tamper detection.

const ALGORITHM = 'aes-256-gcm';

function getKey() {
  const key = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY || '', 'base64');
  if (key.length !== 32) {
    throw new Error(
      'TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key. Generate one with: ' +
      'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"'
    );
  }
  return key;
}

export function encrypt(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Store iv + authTag + ciphertext together, base64, as one column value.
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

export function decrypt(stored) {
  const buf = Buffer.from(stored, 'base64');
  const iv = buf.subarray(0, 12);
  const authTag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
