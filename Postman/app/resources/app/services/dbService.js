const _ = require('lodash'),
  authDataInterface = require('./authDataInterface');

var dbService = {

  /**
   * getData is used to get the partitions from the authDataInterface
   * @param {string} key  the key of the data object
   * @return {Object} returns either an empty object or the object of data available
   */

  async getData (key) {
    // bail out if key is not there.
    if (_.isEmpty(key)) {
      return {};
    }
    let dataStr = await authDataInterface.getItem(key),
        dataObj = {};

    if (_.isEmpty(dataStr) || _.isEqual(dataStr === 'undefined')) {
      // Reaching here means, there is no user available so far.
      // so, returns an empty object.
      return {};
    }
    try {
      // Local storage will store only strings, so we need to parse them out before returning.
      dataObj = dataStr;
    }
    finally {
      // returns the parsed data object.
      return dataObj;
    }
  },

  /**
   * setData is used to set the data in authDataInterface
   * @param {string} key  the key of the data object
   * @param {Obj} dataObj the data object to be updated in the authDataInterface
   *
   */

  async setData (key, dataObj) {
    // bail out if key is not there.
    if (_.isEmpty(key)) {
      return;
    }
    let dataString = {};

    // We need to proceed only if the data provided is an object.
    if (_.isObject(dataObj)) {
      try {
        // Stringify it before storing it in the authDataInterface.
        dataString = dataObj;
      }
      finally {
        // store it in the authDataInterface with the key data.
        await authDataInterface.setItem(key, dataString);
      }
    }
  }
};

module.exports = dbService;

