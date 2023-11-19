// Combines all schedulers passed as arguments, fires on every timeout
export const combine = (...intervals) => {
  return (now = Date.now()) => {
    return intervals
      .reduce((acc, curr) => {
        return Math.min(acc, curr(now));
      }, Number.MAX_VALUE);
  };
};

// Fires once, optionally after an initial delay
export const once = (initialDelay = 0) => {
  let triggered = false;

  return () => {
    if (triggered === false) {
      triggered = true;
      return initialDelay;
    }

    return -1;
  }
};

// Fires every day at a given time
export const daily = (hour, minute = 0, second = 0) => {
  return (now = Date.now()) => {
    const next = new Date();
    next.setHours(hour, minute, second, 0);

    if (now > next.getTime()) {
      next.setDate(next.getDate() + 1);
    }

    return next.getTime() - now;
  }
};

// Run a callback between two given recurring scheduled times
export const between = (start, end, callback) => {
  if (start() > end()) { return callback() }
};
