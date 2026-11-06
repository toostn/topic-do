import { validateDelay } from './timers.js';

export const matchTopic = (filter, topic) => {
  if (filter.startsWith('$share/')) {
    const shared = /^\$share\/([^/#+]+)\/(.+)$/.exec(filter);
    if (shared === null) return false;
    filter = shared[2];
  }

  if (filter.length === 0 || topic.length === 0) return false;

  const levels = filter.split('/');
  const topicLevels = topic.split('/');

  // Wildcards must occupy whole levels, and # must be last.
  if (levels.some((level, index) =>
    (level.includes('+') && level !== '+') ||
    (level.includes('#') && (level !== '#' || index !== levels.length - 1))
  )) return false;

  // Leading wildcards never match MQTT system topics, including shared filters.
  if (topic.startsWith('$') && !filter.startsWith('$')) return false;

  for (let index = 0; index < levels.length; index++) {
    const level = levels[index];
    if (level === '#') return true;
    if (index >= topicLevels.length) return false;
    if (level !== '+' && level !== topicLevels[index]) return false;
  }

  return levels.length === topicLevels.length;
};

export const cache = () => {
  const items = Object.create(null);
  return {
    get: (key) => items[key],
    set: (key, value) => items[key] = value
  }
};

// Creates a function that runs the passed callback only once, after the
// function has not been called for the amount of milliseconds specified.
export const singleTimer = (delay) => {
  validateDelay(delay);
  let timeout = null;

  return (callback) => {
    if (timeout !== null) {
      clearTimeout(timeout);
    }

    timeout = setTimeout(() => {
      timeout = null;
      const reportError = error => console.error('topic-do: timer callback failed', error);
      try {
        Promise.resolve(callback()).catch(reportError);
      } catch (error) {
        reportError(error);
      }
    }, delay);
  }
};

// Returns a topicDo handler that can send an initial message and then another
// message after a delay. The sending of the second value is done only once,
// after the handler has not been called for an entire delay
export const triggerTimer = (filter, topics, messageOn, messageOff, delay) => {
  let timer = singleTimer(delay);

  return (topic, message, cache, publish) => {
    if (filter == null || filter(topic, message, cache) === true) {
      if (messageOff != null) {
        timer(() => {
          return publish(topics.map(t=> [t, messageOff]));
        });
      }

      return (messageOn != null) 
        ? topics.map(t => [t, messageOn])
        : [];
      }
  };
};
