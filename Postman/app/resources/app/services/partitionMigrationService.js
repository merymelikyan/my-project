const _ = require('lodash'),
  partitionService = require('./partitionService'),
  shellController = require('./shellController'),
  shellMeta = require('./shellMeta');

const scratchpadContext = { namespace: 'scratchPad', userId: 0, teamId: 0 };

/**
 * Determine if v7 partition system's active partition is not associated with any user account
 * @returns {Boolean} returns true if the active partition of v7 is not associated with any user account. false, otherwise.
 */
async function isV7ActivePartitionSignedOut () {
  const activePartitionId = shellMeta.getActivePartition();

  if (!activePartitionId) {
    return false;
  }

  const v7PartitionsObj = await shellController.partitions.getValue();

  if (!v7PartitionsObj[activePartitionId].userId) {
    return true;
  }

  return false;
}

/**
 * Checks two things
 * 1. Whether the partition is associated with user account on V7 partition system
 * 2. Whether the partition last updated is latest on V7 partition system
 * @param {Object} v8Partition The v8 partition object
 * @param {String} partition.id The partition identifier
 * @param {String} partition.lastUpdated The last accessed timestamp of partition
 * @returns {Boolean}
 */
async function isPartitionAccessedUsingV7BeforeOpeningV8App (v8Partition) {
  if (_.isEmpty(v8Partition) || _.isEmpty(v8Partition.id) || _.isEmpty(v8Partition.meta) || _.isEmpty(v8Partition.meta.lastUpdated)) {
    return;
  }

  const v7PartitionsObj = await shellController.partitions.getValue(),
    userId = v7PartitionsObj[v8Partition.id] && v7PartitionsObj[v8Partition.id].userId;

  if (_.isEmpty(userId)) {
    return;
  }

  const v7Partition = await shellController.users.getValue()[userId];

  if (_.isEmpty(v7Partition)) {
    return;
  }

  return Date.parse(v7Partition.lastUpdated) > Date.parse(v8Partition.meta.lastUpdated);
}

/**
 * Checks if the partition is an orphaned partition on V7 partition system
 * @param {String} partitionId The partition identifier
 * @returns {Boolean}
 */
async function isV7OrphanedPartition (partitionId) {
  if (_.isEmpty(partitionId)) {
    return;
  }

  const partitionsObj = await shellController.partitions.getValue();

  if (_.isEmpty(partitionsObj[partitionId])) {
    return false;
  }

  const userId = partitionsObj[partitionId].userId;

  return _.isEmpty(userId);
}

/**
 * ScratchPad partition initially used transit partition with namespace 'users'
 * to simulate the v7 application behaviour
 * To change the migration of scratchpad data to be on demand rather than automatic
 * we are moving the partition to 'scratchPad' namespace
 */
async function rectifyNamespaceOfScratchPadPartition () {
  const scratchpadPartitions = partitionService.find(scratchpadContext);

  if (!_.isEmpty(scratchpadPartitions)) {
    return;
  }
  pm.logger.info('partitionMigrationService~rectifyNamespaceOfScratchPadPartition: There is no partition with scratchpad namespace');

  const currentTransitPartitions = partitionService.find({ namespace: 'users', userId: 0, teamId: 0 });

  if (_.isEmpty(currentTransitPartitions)) {
    pm.logger.info('partitionMigrationService~rectifyNamespaceOfScratchPadPartition: There is no transit partition which could have been used for scratchpad');
    return;
  }

  pm.logger.info('partitionMigrationService~rectifyNamespaceOfScratchPadPartition: There is transit partition which could have been used for scratchpad. changing namespace');

  await partitionService.updateOne(currentTransitPartitions[0].id, scratchpadContext, currentTransitPartitions[0].meta);
}

/**
 * Logs the state of v7 partition system
 */
function logV7PartitionSystemState () {
  pm.logger.info('partitionMigrationService: State of V7 partition:');

  const v7UsersObj = shellController.getUsers(),
    v7PartitionsObj = shellController.partitions.getValue(),
    printables = [];

  Object.values(v7PartitionsObj).forEach((partition) => {
    const printablePartition = {
      partitionId: partition.id
    };

    if (!_.isEmpty(partition.userId)) {
      printablePartition.userId = partition.userId;
      printablePartition.lastUpdated = v7UsersObj[partition.userId].lastUpdated;
    }
    printables.push(printablePartition);
  });

  pm.logger.info('partitionMigrationService: V7 partitions', printables);

  // pm.logger.info('partitionMigrationService: V7 lastActiveUser', shellMeta.lastActiveUser);
  // pm.logger.info('partitionMigrationService: V7 activePartition', shellMeta.activePartition);
  // pm.logger.info('partitionMigrationService: V7 isPartitionDirty', shellMeta.isPartitionDirty);
}

const partitionMigrationService = {
  async init () {
    await shellController.init();
    await shellMeta.init();
    logV7PartitionSystemState();
    await rectifyNamespaceOfScratchPadPartition();
    pm.logger.info('partitionMigrationService~init: Success');
  },

  /**
   * Checks if the partition is associated with a user account on V7 partition system
   * @param {String} partitionId The partition identifier
   * @returns {Boolean}
   */
  async isV7UserContextPartition (partitionId) {
    if (_.isEmpty(partitionId)) {
      return;
    }

    const partitionsObj = await shellController.partitions.getValue();

    if (_.isEmpty(partitionsObj[partitionId])) {
      return false;
    }

    const userId = partitionsObj[partitionId].userId;

    return _.isString(userId);
  },

  async runV8PartitionsIntegrity () {
    // Check integrity of v8 user context partitions
    const context = { namespace: 'users' },
      v8Partitions = await partitionService.find(context),
      isCurrentPartitionActiveSignedoutV7 = await isV7ActivePartitionSignedOut(),
      activeV7PartitionId = shellMeta.getActivePartition(),
      userContextPartitionsToBeRectified = [];

    await Promise.all(v8Partitions.map(async (partition) => {
      if (partition.context && partition.context.userId) {
        if (await isPartitionAccessedUsingV7BeforeOpeningV8App(partition) || (partition.id === activeV7PartitionId && isCurrentPartitionActiveSignedoutV7)) {
          userContextPartitionsToBeRectified.push(partition.id);
        } else if (await isV7OrphanedPartition(partition.id)) {
          userContextPartitionsToBeRectified.push(partition.id);
        }
      }
    }));

    pm.logger.info('partitionMigrationService~runV8PartitionsIntegrity: Two way migration~ removing the following partitions from v8', userContextPartitionsToBeRectified);

    // Remove the partition mappings from v8 and let the migration be hit when the partition is used.
    await partitionService.removePartitionEntries(userContextPartitionsToBeRectified);

    // Check integrity of v8 scratchpad partition
    const scratchPadPartitions = await partitionService.find(scratchpadContext);

    if (_.isEmpty(scratchPadPartitions)) {
      return;
    }

    if (await this.isV7UserContextPartition(scratchPadPartitions[0].id)) {
      // Remove the scratchpad partition mapping from v8 and
      // let the migration be hit when the v7 user context partition is used on v8 application.
      pm.logger.info('partitionMigrationService~runV8PartitionsIntegrity: Two way migration~ removing the scratchpad entry from v8', scratchPadPartitions[0].id);
      return partitionService.removePartitionEntries([scratchPadPartitions[0].id]);
    }
  },

  async migrateSignedOutPartitionAsScratchpad () {
    // Bail out, if v7 does not have a signed out partition
    if (!await isV7ActivePartitionSignedOut()) {
      return;
    }

    // Bail out, if v8 already have a scratchpad partitions
    // This is to maintain a single scratchpad partition
    const scratchPadPartitions = await partitionService.find(scratchpadContext);

    if (!_.isEmpty(scratchPadPartitions)) {
      return;
    }

    pm.logger.info('partitionMigrationService~migrateSignedOutPartitionAsScratchpad: Migrating v7 logged out state partition as scratchpad on v8 partition system', { partitionId: shellMeta.getActivePartition() });

    return partitionService.makeRawPartition(shellMeta.getActivePartition(), scratchpadContext, {});
  }
};

module.exports = partitionMigrationService;
