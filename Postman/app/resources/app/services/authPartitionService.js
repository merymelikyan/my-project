const authDataInterface = require('./authDataInterface');

const authPartitionService = {
  async getActivePartition () {
    let partitionsMeta = await authDataInterface.getItem('v8PartitionsNamespaceMeta');
    return this.getPersistedPartitionString(partitionsMeta?.users?.activePartition);
  },

  getPersistedPartitionString (partitionId) {
    // Return an empty string - partition without a name on file system
    if (partitionId === 'default') {
      return '';
    }

    return 'persist:' + partitionId;
  }
};

module.exports = authPartitionService;
