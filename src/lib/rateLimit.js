import { httpError } from './ownership.js';

// Each receipt scan costs real money (one AI call), so cap how many a
// single user can trigger per hour. In-memory is fine for a single
// Railway instance; with several instances the real cap would be
// roughly limit x instances, which is still a useful brake.
const windows = new Map();

export function enforceLimit(key, limit, windowMs) {
  const now = Date.now();
  const recent = (windows.get(key) || []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    throw httpError(429, 'Too many scans in a short time. Please wait a little and try again.');
  }
  recent.push(now);
  windows.set(key, recent);
}
