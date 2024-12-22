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

export const DAYS = {
  weekdays: [1, 2, 3, 4, 5],
  weekends: [0, 6],
  all: [0, 1, 2, 3, 4, 5, 6]
};


export const daily = (scheduler, on = DAYS.all) => {
  return (now = Date.now()) => {
    let date = new Date(now);
    date.setHours(0, 0, 0, 0);
    let next = -1;
    let count = 0;

    do {
      if (on.includes(date.getDay())) {
        next = (date.getTime() - now) + scheduler(date.getTime());
      }

      date.setDate(date.getDate() + 1);
    } while (next < 0 && ++count <= 7);

    return next;
  };
};

export const at = (hours, minutes = 0, seconds = 0) => {
  return (now = Date.now()) => {
    const next = new Date(now);
    next.setHours(hours, minutes, seconds, 0);

    return next.getTime() - now;
  };
};

// Run a callback between two given recurring scheduled times
export const between = (start, end, callback) => {
  if (start() > end()) { return callback() }
};
