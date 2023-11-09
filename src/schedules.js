export const scheduleOnce = () => {
  let triggered = false;

  return () => {
    if (triggered === false) {
      triggered = true;
      return 0;
    }

    return -1;
  }
}
