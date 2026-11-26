import { haversine } from './geometry.mjs';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/**
 * Accuracy-aware smoothing for walking GPS fixes.
 * Returns the previous position unchanged when a fix is stale or implausible.
 * Coordinates use Leaflet-style lat/lon fields; no geography policy is applied here.
 */
export function filterGpsFix(previous, next, options = {}) {
  const minJumpDistance = Number.isFinite(options.minJumpDistance) ? options.minJumpDistance : 45;
  const maxWalkingSpeed = Number.isFinite(options.maxWalkingSpeed) ? options.maxWalkingSpeed : 8;
  const jumpAccuracyFactor = Number.isFinite(options.jumpAccuracyFactor) ? options.jumpAccuracyFactor : 2;

  if (!next || ![next.lat, next.lon, next.timestamp, next.accuracy].every(Number.isFinite) ||
      next.lat < -90 || next.lat > 90 || next.lon < -180 || next.lon > 180 ||
      next.accuracy <= 0) {
    return { accepted: false, reason: 'invalid', position: previous || null };
  }

  if (!previous) {
    return { accepted: true, reason: 'initial', position: { ...next } };
  }

  if (![previous.lat, previous.lon, previous.timestamp, previous.accuracy].every(Number.isFinite) ||
      previous.accuracy <= 0) {
    return { accepted: true, reason: 'reset', position: { ...next } };
  }

  const elapsedSeconds = (next.timestamp - previous.timestamp) / 1000;
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) {
    return { accepted: false, reason: 'stale', position: previous };
  }

  const travelled = haversine([previous.lon, previous.lat], [next.lon, next.lat]);
  const uncertainty = previous.accuracy + next.accuracy;
  const plausibleDistance = Math.max(
    minJumpDistance,
    maxWalkingSpeed * elapsedSeconds + uncertainty * jumpAccuracyFactor
  );

  if (!Number.isFinite(travelled) || travelled > plausibleDistance) {
    return { accepted: false, reason: 'jump', position: previous };
  }

  // Give the more accurate measurement more influence, while retaining enough
  // history to suppress GPS jitter without making the arrow feel sluggish.
  const alpha = clamp(previous.accuracy / uncertainty, 0.25, 0.85);
  const position = {
    lat: previous.lat + (next.lat - previous.lat) * alpha,
    lon: previous.lon + (next.lon - previous.lon) * alpha,
    timestamp: next.timestamp,
    accuracy: next.accuracy
  };

  return { accepted: true, reason: 'smoothed', position };
}
