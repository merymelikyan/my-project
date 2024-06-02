const LinkableChannel = require('./LinkableChannel');

/*
  An EventChannel is similar to an EventEmitter, except it doesn't emit events
  to itself; rather, it emits them to its linked "peer" channel.

  Interestingly, an EventChannel can be made to mimic the behavior of an
  EventEmitter by simply linking it to itself.
*/

const LISTENERS = Symbol();
const RECEIVERS = Symbol();

class EventChannel extends LinkableChannel {
  constructor () {
    super();

    this[LISTENERS] = new Map();
    this[RECEIVERS] = [];

    this.addCleanup(() => {
      this[LISTENERS].clear();
      this[RECEIVERS].splice(0);
    });
  }

  on (eventName, listener) {
    if (typeof eventName !== 'string') {
      throw new TypeError('Expected event name to be a string');
    }
    if (typeof listener !== 'function') {
      throw new TypeError('Expected event listener to be a function');
    }

    if (!this.isDestroyed()) {
      const listeners = this[LISTENERS].get(eventName);
      if (listeners) {
        listeners.push(listener);
      } else {
        this[LISTENERS].set(eventName, [listener]);
      }
    }

    return this;
  }

  off (eventName, listener) {
    if (typeof eventName !== 'string') {
      throw new TypeError('Expected event name to be a string');
    }
    if (typeof listener !== 'function') {
      throw new TypeError('Expected event listener to be a function');
    }

    const listeners = this[LISTENERS].get(eventName);
    if (listeners) {
      const index = listeners.indexOf(listener);
      if (index !== -1) {
        if (listeners.length === 1) {
          this[LISTENERS].delete(eventName);
        } else {
          listeners.splice(index, 1);
        }
      }
    }

    return this;
  }

  receive (eventName, data) {
    if (typeof eventName !== 'string') {
      throw new TypeError('Expected event name to be a string');
    }
    if (this.isDestroyed()) {
      return;
    }

    for (const receiver of this[RECEIVERS]) {
      receiver(eventName, data);
    }

    const listeners = this[LISTENERS].get(eventName);
    if (listeners) {
      for (const listener of [...listeners]) {
        listener(data);
      }
    }
  }

  // EventChannels can be consumed as an AsyncIterators. In this mode, each
  // event is yielded by the AsyncIterator until the EventChannel is destroyed.
  // The AsyncIterator cannot throw, unless its ".throw()" method is called.
  // If the AsyncIterator is cancelled via its ".throw()" method or ".return()"
  // method, the EventChannel will also be destroyed.
  async *[Symbol.asyncIterator] () {
    if (this.isDestroyed()) {
      return;
    }

    let done = false;
    let queue = [];
    let notify = () => {};

    this[RECEIVERS].push((_, data) => {
      if (done) return;
      queue.push(data);
      notify();
    });

    this.addCleanup(() => {
      done = true;
      notify();
    });

    try {
      do {
        await new Promise((r) => { notify = r; });
        while (queue.length) yield queue.shift();
      } while (!done); // eslint-disable-line no-unmodified-loop-condition
    } finally {
      done = true;
      queue = [];
      notify = () => {};
      this.destroy();
    }
  }
}

module.exports = EventChannel;
