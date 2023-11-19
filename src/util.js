export const matchTopic = (ts,t) => {
  if (ts == "#") {
    return true;
  } else if(ts.startsWith("$share")){
    ts = ts.replace(/^\$share\/[^#+/]+\/(.*)/g,"$1");
  }

  const re = new RegExp("^"+ts.replace(/([\[\]\?\(\)\\\\$\^\*\.|])/g,"\\$1").replace(/\+/g,"[^/]+").replace(/\/#$/,"(\/.*)?")+"$");

  return re.test(t);
};

export const cache = () => {
  const items = {};
  return {
    get: (key) => items[key],
    set: (key, value) => items[key] = value
  }
};

// Creates a function that runs the passed callback only once, after the
// function has not been called for the amount of milliseconds specified.
export const singleTimer = (delay) => {
  let timeout = null;

  return (callback) => {
    if (timeout !== null) {
      clearTimeout(timeout);
    }

    timeout = setTimeout(() => { callback(); }, delay);
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
          publish(topics.map(t=> [t, messageOff]));
        });
      }

      return (messageOn != null) 
        ? topics.map(t => [t, messageOn])
        : [];
      }
  };
};
