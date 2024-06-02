const _ = require('lodash'),
  partitionService = require('./partitionService');

const namespace = 'scratchPad';

/**
 * Creates a scratchpad partition
 * @returns {Promise<String>} Promise which resolves to created partition id
 */
function createScratchpadPartition () {
  const context = {
      namespace,
      userId: 0,
      teamId: 0
    },
    meta = { isDirty: false };

  return partitionService.create(context, meta)
    .then((partition) => {
      return partition.id;
    });
}

const scratchPadPartitionService = {
  /**
   * Gets the active scratchpad parition id on availability
   * @returns {Promise<String>} Promise resolving to the active scratchpad partition id.
   */
  async getCurrent () {
    const partitions = await partitionService.find({ namespace });

    if (_.isEmpty(partitions)) {
      return createScratchpadPartition();
    }

    return partitions[0].id;
  },

  /**
   * Check if the provided partition id is of a scratchpad
   * @param {String} partitionId partition id
   * @returns {Boolean}
   */
  async isScratchPadPartitionId (partitionId) {
    if (!partitionId) {
      return false;
    }

    const partitions = await partitionService.find({ namespace });

    if (_.isEmpty(partitions)) {
      return false;
    }

    return partitions[0].id === partitionId;
  }
};

module.exports = scratchPadPartitionService;
