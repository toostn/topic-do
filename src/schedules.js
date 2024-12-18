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

// Fires on given days at the specified time
// TODO: Should add a safeguard against insane values for on, as it can cause an
// infinite loop until time number reaches max value.
export const daily = ({at, on}) => {
  return (now = Date.now()) => {
    const next = new Date();
    next.setHours(...at, 0);

    if (now > next.getTime()) {
      do {
        next.setDate(next.getDate() + 1);
      } while (on.includes(next.getDay()) === false);
    }

    return next.getTime() - now;
  }
};

// Fires every day at a given time
export const dailyAt = (hour, minute = 0, second = 0) => {
  return daily({
    at: [hour, minute, second],
    on: DAYS.all
  });
};

// Run a callback between two given recurring scheduled times
export const between = (start, end, callback) => {
  if (start() > end()) { return callback() }
};
