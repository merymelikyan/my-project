const nedb = require('nedb'),
  electron = require('electron'),
  path = require('path'),
  dataPath = electron.app.getPath('userData'),
  _ = require('lodash');

class WindowController {
  constructor () {
    this.isInitialized = false;
  }

  initialize ({ eventBus }) {
    if (this.isInitialized) {
      return Promise.resolve();
    }

    this.eventBus = eventBus.channel('window-controller-events');
    this.eventBus.subscribe((event) => {
      if (event.namespace !== 'window-controller' || !event.name || !event.meta || event.meta.type !== 'request') {
        return;
      }

      let { criteria, options } = event.data,
        pendingOperationPromise;

      switch (event.name) {
        case 'bootstrap':
          pendingOperationPromise = this.bootstrap(criteria, options);
          break;
        case 'get':
          pendingOperationPromise = this.get(criteria);
          break;
        case 'getAll':
          pendingOperationPromise = this.getAll(criteria);
          break;
        case 'create':
          pendingOperationPromise = this.create(criteria, options);
          break;
        case 'count':
          pendingOperationPromise = this.count(criteria);
          break;
        case 'update':
          pendingOperationPromise = this.update(criteria);
          break;
        case 'delete':
          pendingOperationPromise = this.delete(criteria);
          break;
      }

      pendingOperationPromise
        .then((result) => {
          this.eventBus.publish({
            name: event.name,
            namespace: 'window-controller',
            data: { result },
            meta: { _id: event.meta && event.meta._id, type: 'response' }
          });
        });
    });

    const dbPath = path.join(dataPath, 'window');

    this.db = new nedb({ filename: dbPath, inMemoryOnly: false });

    return new Promise((resolve, reject) => {
      this.db.loadDatabase((err) => {
        if (err) {
          return reject(err);
        }

        this.isInitialized = true;
        return resolve();
      });
    });
  }

  bootstrap (definition, options) {
    global.pm.window = { id: definition.id };
    return Promise.resolve([definition, options]);
  }

  get (criteria) {
    if (!this.db) {
      return Promise.reject('WindowController~get: The DB has not been initialized');
    }

    // Insert the documents into the db.
    return new Promise((resolve, reject) => {
      this.db.findOne(criteria, function (err, matchingRecords) {
        if (err) {
          return reject(err);
        }

        return resolve(matchingRecords);
      });
    });
  }

  getAll (criteria) {
    if (!this.db) {
      return Promise.reject('WindowController~getAll: The DB has not been initialized');
    }

    // Insert the documents into the db.
    return new Promise((resolve, reject) => {
      this.db.find(criteria, function (err, matchingRecords) {
        if (err) {
          return reject(err);
        }

        return resolve(matchingRecords);
      });
    });
  }

  create (definition, options = {}) {
    if (!this.db) {
      return Promise.reject('WindowController~create: The DB has not been initialized');
    }

    if (_.isEmpty(definition) || !definition.id) {
      return Promise.reject('WindowController~create: Invalid definition given. Cannot create in DB');
    }

    definition._id = definition.id;

    // Insert the documents into the db.
    return new Promise((resolve, reject) => {
      this.db.insert(definition, function (err, newRecord) {
        if (err) {
          if (err.errorType === 'uniqueViolated') {
            err.footprint = { identity: 'notUnique' };

            // If we can infer which attribute this refers to, add a `keys` array to the error.
            // First, see if only one value in the new record matches the value that triggered the uniqueness violation.
            if (_.filter(_.values(definition), function (val) { return val === err.key; }).length === 1) {
              // If so, find the key (i.e. column name) that this value was assigned to, add set that in the `keys` array.
              err.footprint.keys = [_.findKey(definition, function (val) { return val === err.key; })];
            } else {
              err.footprint.keys = [];
            }
          }

          return reject(err);
        }

        if (options.fetch) {
          return resolve(newRecord);
        }

        return resolve();
      });
    });
  }

  count (criteria) {
    if (!this.db) {
      return Promise.reject('WindowController~count: The DB has not been initialized');
    }

    return new Promise((resolve, reject) => {
      this.db.count(criteria, (err, count) => {
        if (err) {
          return reject(err);
        }

        return resolve(count);
      });
    });
  }

  update (definition, options = {}) {
    if (!this.db) {
      return Promise.reject('nedbInterface~update: The DB has not been initialized');
    }

    if (_.isEmpty(definition) || !definition.id) {
      return Promise.reject('nedbInterface~update: No updates given. Cannot update item(s).');
    }

    const criteria = { id: definition.id },
      newUpdates = definition;

    return new Promise((resolve, reject) => {
      // Update the documents in the db.
      this.db.update(criteria, { '$set': newUpdates }, { multi: true, returnUpdatedDocs: true }, function (err, numAffected, updatedRecords) {
        if (err) {
          if (err.errorType === 'uniqueViolated') {
            err.footprint = { identity: 'notUnique' };

            // If we can infer which attribute this refers to, add a `keys` array to the error.
            // First, see if only one value in the updated data matches the value that triggered the uniqueness violation.
            if (_.filter(_.values(newUpdates), function (val) { return val === err.key; }).length === 1) {
              // If so, find the key (i.e. column name) that this value was assigned to, add set that in the `keys` array.
              err.footprint.keys = [_.findKey(newUpdates, function (val) { return val === err.key; })];
            } else {
              err.footprint.keys = [];
            }
          }
          return reject(err);
        }

        if (options.fetch) {
          return resolve(updatedRecords);
        }

        return resolve();
      });
    });
  }

  delete (criteria, options = {}) {
    if (!this.db) {
      return Promise.reject('nedbInterface~destroy: The DB has not been initialized');
    }

    let itemsToReturn = [];

    return Promise.resolve()
      .then(() => {
        // If the fetch option has been passed, find and cache the items before destroying them
        if (options.fetch) {
          return this.find(criteria)
            .then((items) => {
              itemsToReturn = items;
            });
        }
      })
      .then(() => {
        return new Promise((resolve, reject) => {
          this.db.remove(criteria, { multi: true }, function (err) {
            if (err) {
              return reject(err);
            }

            options.fetch ? resolve(itemsToReturn) : resolve();
          });
        });
      });
  }
}

module.exports = new WindowController();
