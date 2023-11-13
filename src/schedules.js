export const scheduleOnce = (initialDelay = 0) => {
  let triggered = false;

  return () => {
    if (triggered === false) {
      triggered = true;
      return initialDelay;
    }

    return -1;
  }
}
