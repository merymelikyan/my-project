const _ = require('lodash');
const authDataInterface = require('./authDataInterface');

var shellMeta = {

  /**
   * lastActiveUser is the last successful logged in user in the application.
   */
  lastActiveUser: null,

  /**
   * activePartition is the current active partition in the system.
   */
  activePartition: null,

  /**
   * isPartitionDirty, will become dirty if the user start to interact with the application
   */
  isPartitionDirty: null,

  /**
   * init, initialize function to load the data from the localstorage.
   */
  async init () {
    await this.loadFromDb();

    pm.logger.info('shellMeta~init: Success');
  },

  /**
   * loadFromDb, it loads the following properties from the localstorage
   * 1. lastActiveUser
   * 2. activePartition
   * 3. isPartitionDirty
   */

  async loadFromDb () {
    this.lastActiveUser = await this.dbService.get('lastActiveUser');
    this.activePartition = await this.dbService.get('activePartition');
    try {
      this.isPartitionDirty = JSON.parse(await this.dbService.get('isPartitionDirty'));
    } catch (e) {
      pm.logger.error('ShellMeta~loadFromDb - Error in parsing users info from localStorage', e);
      this.isPartitionDirty = false;
    }
  },

  /**
   * getIsPartitionDirty
   * it returns a flag saying whether the partition is dirty or not (whether the user started using it or not)
   * @return {Boolean}
   */
  getIsPartitionDirty () {
    return this.isPartitionDirty;
  },

  /**
   * setIsPartitionDirty
   * it sets the isPartitionDirty flag in the cache and in memory
   * @return {Boolean}
   */
  async setIsPartitionDirty (isDirty) {
    this.isPartitionDirty = isDirty;

    // updates the localStorage immediately.
    await this.dbService.set('isPartitionDirty', isDirty);
  },

  /**
   * getLastActiveUser
   * it returns the last active user in the application
   * @return {string=} This would return the last active user if available or else returns null.
   */

  getLastActiveUser () {
    return this.lastActiveUser;
  },

   /**
   * setLastActiveUser
   * it sets the last active user in the cache and in memory
   * @param {string} id, the user id to be stored as last active user
   */

  async setLastActiveUser (id) {
    // Store in the local cache
    this.lastActiveUser = id;

    // updates the localStorage immediately.
    await this.dbService.set('lastActiveUser', id);
  },

  /**
   * getActivePartition
   * it returns the active partition in the application
   * @return {string=} This would return the active partition
   */

  getActivePartition () {
    return this.activePartition;
  },

  /**
   * setActivePartition
   * it sets the current active partition in the cache and in memory
   * @param {string} id, the partition id which is currently active
   */
  async setActivePartition (id) {
    // Store in the local cache
    this.activePartition = id;

    // updates immediately in the localStorage
    await this.dbService.set('activePartition', id);
  },

  /**
   * dbService used to provide store and get data out of localStorage.
   */
  dbService: {

    /**
     * get the value of localStorage of a particular key
     * if it is available, it returns the value, else return null.
     * @param {string=} key the key of the data
     */

    async get (key) {
      let item = await authDataInterface.getItem(key);
      if (_.isEmpty(item) || item === 'undefined') {
        return null;
      }
      return item;
    },

    /**
     * set the value to localStorage for a particular key
     */

    async set (key, value) {
      await authDataInterface.setItem(key, value);
    }
  }
};

module.exports = shellMeta;
