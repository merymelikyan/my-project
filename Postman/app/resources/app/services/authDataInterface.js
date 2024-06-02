const storage = require('electron-json-storage'),
  sendAnalyticsEvent = require('./sendAnalytics'),
  DB_KEY = 'userPartitionData';

const authDataInterface = {
  getAll () {
    return new Promise((resolve, reject) => {
      storage.get(DB_KEY, (err, data) => {
        if (err) {
          sendAnalyticsEvent('auth-data-getAll', 'failed', `${err && err.name}:${err && err.message}`);
          return reject(err);
        }

        sendAnalyticsEvent('auth-data-getAll', 'successful');
        resolve(data);
      });
    });
  },

  getItem (key) {
    if (!key) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      storage.get(DB_KEY, (err, data) => {
        if (err) {
          sendAnalyticsEvent('auth-data-getItem', 'failed', `${err && err.name}:${err && err.message}`);
          return reject(err);
        }

        sendAnalyticsEvent('auth-data-getItem', 'successful');
        resolve(data[key]);
      });
    });
  },

  setItem (key, value) {
    return this.getAll()
      .then((data) => {
        // change the value for the specific key
        data[key] = value;
        return this.setData(data);
      });
  },

  setData (data) {
    if (!data) {
      return Promise.resolve();
    }

    data = this.sanitizeData(data);

    return new Promise((resolve, reject) => {
      storage.set(DB_KEY, data, (err) => {
        if (err) {
          sendAnalyticsEvent('auth-data-setData', 'failed', `${err && err.name}:${err && err.message}`);
          return reject(err);
        }

        sendAnalyticsEvent('auth-data-setData', 'successful');
        resolve();
      });
    });
  },

  exists () {
    return new Promise((resolve, reject) => {
      storage.has(DB_KEY, (err, hasKey) => {
        if (err) {
          sendAnalyticsEvent('auth-data-exists', 'failed', `${err && err.name}:${err && err.message}`);
          return reject(err);
        }

        sendAnalyticsEvent('auth-data-exists', 'successful');
        resolve(hasKey);
      });
    });
  },

  clear () {
    return new Promise((resolve, reject) => {
      storage.remove(DB_KEY, (err) => {
        if (err) {
          sendAnalyticsEvent('auth-data-remove', 'failed', `${err && err.name}:${err && err.message}`);
          return reject(err);
        }

        sendAnalyticsEvent('auth-data-remove', 'successful');
        resolve();
      });
    });
  },

  sanitizeData (data) {
    if (!data) {
      return;
    }

    let v8Partitions = data.v8Partitions;

    if (v8Partitions) {
      Object.keys(v8Partitions).forEach((key) => {
        if (v8Partitions[key]?.meta?.auth) {
          delete v8Partitions[key].meta.auth;
        }
      });
    }

    return data;
  }
};

module.exports = authDataInterface;
