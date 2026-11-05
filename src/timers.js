// Node clamps larger timeouts to ~1ms, which is unsafe for device automation.
export const validateDelay = (delay, allowNegative = false) => {
  if (typeof delay !== 'number' || !Number.isFinite(delay)) {
    throw new TypeError('Timer delay must be a finite number of milliseconds');
  }
  if ((!allowNegative && delay < 0) || delay > 2147483647) {
    throw new RangeError('Timer delay must be between 0 and 2147483647 milliseconds (negative schedules disable execution)');
  }
  return delay;
};
