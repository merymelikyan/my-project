const DEFAULT_PARTITION = 'default';
const DEFAULT_COOKIE_PARTITION = 'persist:postman_user_cookies';

const partitionUtils = {

  /**
   * Gets the partition string, which can be used while working with electron's session API or loading a web view with a persisted partition
   * @param {String} partitionId The partition which needs to be transformed
   * @returns {String} This string can be empty, which means the default partition
   * */
  getPersistedPartitionString (partitionId) {
    // Return an empty string - partition without a name on file system
    if (partitionId === DEFAULT_PARTITION) {
      return '';
    }

    return 'persist:' + partitionId;
  },

  /**
   * Helper to get cookie Electron partition ID of an user
   * @param {String} partitionId
   * @returns {String} partitionID
  */
  getCookiePartitionId (partitionId) {
    const partitionExtension = partitionId === DEFAULT_PARTITION ? '' : `_${partitionId}`;

    return `${DEFAULT_COOKIE_PARTITION}${partitionExtension}`;
  }
};

module.exports = partitionUtils;
