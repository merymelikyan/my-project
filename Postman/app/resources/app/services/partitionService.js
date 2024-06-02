// partition service
const _ = require('lodash'),
  dbService = require('./dbService'),
  authPartitionService = require('./authPartitionService'),
  { session } = require('electron'),
  uuidV4 = require('uuid/v4'),
  DB_KEY = 'v8Partitions',
  NAMESPACE_META_SUFFIX = 'NamespaceMeta';

/**
 * Returns the partitions object that we store in the DB for keeping all the partition mappings.
 * @return {Object} the localStorage value
 */
function getPartitionsValue () {
  return dbService.getData(DB_KEY);
}

/**
 * Stores the partitions object in the DB for keeping all the partition mappings.
 * @param {Object} obj The object to be set to the value property.
 */
async function setPartitionsValue (obj) {
  // Update the localStorage on the changes made.
  await dbService.setData(DB_KEY, obj);
}

/**
 * Returns the Namespce metas object of partitions that we store in the DB.
 * @return {Object} the localStorage value
 */
function getGlobalMetaValue () {
  return dbService.getData(DB_KEY + NAMESPACE_META_SUFFIX);
}

/**
 * Stores the Namespce metas object of partitions that we store in the DB.
 * @param {Object} obj The object to be set to the value property.
 */
async function setGlobalMetaValue (obj) {
  // Update the localStorage on the changes made.
  await dbService.setData(DB_KEY + NAMESPACE_META_SUFFIX, obj);
}

/**
 * wipes out the partition's storage.
 * @param {UUID} id, the partition id for which the session needs to cleaned.
 * @returns {Promise<String>} Returns a promise which resolves to the cleaned up partition id.
 */
async function cleanPartitionStorage (id) {
  // Bail out if the id is either empty or not a string
  if (!_.isString(id)) {
    return Promise.reject(new Error('Partition id is not valid string'));
  }

  const persistPartitionId = authPartitionService.getPersistedPartitionString(id),
    partitionSession = session.fromPartition(persistPartitionId);

  return partitionSession.clearStorageData()
    .then(() => {
      return id;
    });
}

/**
 * @returns {String[]}Returns an array of orphaned partition ids
 */
async function getAllOrphanedPartitions () {
  const partitionsObj = await getPartitionsValue(),
    orphanedPartitionIds = [];

  // Partition is orphaned if its context is empty
  _.forEach(partitionsObj, function (partition, id) {
    if (_.isEmpty(partition.context)) {
      orphanedPartitionIds.push(id);
    }
  });

  return orphanedPartitionIds;
}

/**
 * Finds and recycles a reusable partition, if available
 * @returns {Promise<String>} Promise resolves to recycled partition id.
 */
function findRecycledPartition () {
  return getAllOrphanedPartitions()
    .then((orphanedPartitions) => {
      let cleanPromises = orphanedPartitions.map((partitionId) => cleanPartitionStorage(partitionId));

      // Promise.race() doesn't resolve or reject if there are no promises
      if (_.isEmpty(cleanPromises)) {
        return Promise.reject('There is no recyclable partition');
      }

      return Promise.race(cleanPromises);
    });
}

/**
 * Maintains the partitions using the following datastructure
 * {
 *  'examplepartitionId': {
 *    'context': {
 *        'namespace': 'exampleNamespace'
 *     },
 *    'meta': {}
 *  },
 * 'otherpartitionId': {
 *    'context': {
 *        'namespace': 'otherNamespace'
 *     },
 *    'meta': {}
 *  }
 * }
 */
const partitionService = {
  /**
   * Makes a partition orphan by clearing the partition object, both context and meta
   * @param {String[]} partitionIdsList An array of partition ids
   */
  async makeOrphan (partitionIdsList = []) {
    const partitionsObj = await getPartitionsValue();

    partitionIdsList.forEach((partitionId) => partitionsObj[partitionId] = { });
    await setPartitionsValue(partitionsObj);
  },

  /**
   * Creates/makes a partition with provided context and meta
   * @param {String} partitionId The partition id
   * @param {Object} context The context object containing user id and team id
   * @param {Object} meta The meta data related to user context
   */
  async makeRawPartition (partitionId, context, meta) {
    await this.makeOrphan([partitionId]);
    await this.updateOne(partitionId, context, meta);
  },

  /**
  * Finds a reusable partition, if exists. Else, creates a new one.
  * @returns {Promise<String>} Returns a promise which resolves to new or reusable partition id
  */
  findRecycledOrCreatePartition () {
    return findRecycledPartition()
      .catch((e) => {
        // There is no recyclable partition, we are going to create one and add to the storage.
        const partitionId = uuidV4();

        return this.makeOrphan([partitionId])
          .then(() => {
            return partitionId;
          });
      });
  },

  /**
   * Creates a partition associating the provided context.
   * Returns corresponding partition object, if it exists.
   * @param {Object} context The context object containing the fields which constitutes the uniqueness of a partition.
   * This will be used to compare two contexts. The namespace is mandatory part of this context.
   * @param {Object} meta Arbitrary data that the consumer maintains. No restrictions on this data.
   * @returns {Promise<Object>} Promise which resolves to partition object. Rejects on invalid arguments
   */
  async create (context, meta) {

    // Bail out if meta is not an object
    if (!_.isObject(meta)) {
      return new Error('Meta should be a valid object');
    }

    // Bail out if namespace is not available in context
    if (_.isEmpty(context) || !_.isString(context.namespace)) {
      return new Error('Context should be valid object containing namespace');
    }

    // Reaching here means the provided context is not associated with any partition.
    const foundPartitions = await this.find(context);

    if (!_.isEmpty(foundPartitions)) {
      pm.logger.info('partitionService~create: found a partition with context: ', JSON.stringify(context));
      return foundPartitions[0];
    }

    const id = await this.findRecycledOrCreatePartition();

    return this.updateOne(id, context, meta);
  },

  /**
   * Filters the partitions within the namespace considering the context provided.
   * @param {Object} context The context object to use, as filter criteria. The context could be partial.
   * @returns {Object[]} An array of partition objects matching the filter criteria. Empty array, if no results.
   */
  async find (context) {
    const result = [];

    // Bail out if namespace is not available in context
    if (_.isEmpty(context) || !_.isString(context.namespace)) {
      return result;
    }

    const partitionsObj = await getPartitionsValue();

    _.forEach(partitionsObj, function (partition, partitionId) {
      if (_.isMatch(partition.context, context)) {
        result.push({
          id: partitionId,
          ...partition
        });
      }
    });

    return result;
  },

  /**
   * Finds the partition object
   * @param {String} id The partition id
   * @returns {Object|undefined} Partition object, if id is valid. undefined, otherwise.
   */
  async findOne (id) {
    // Bail out if the id is either empty or not a string
    if (_.isEmpty(id) || !_.isString(id)) {
      return;
    }

    const partitionsObj = await getPartitionsValue();

    // Bail out if the partition id is not available
    if (!partitionsObj[id]) {
      return;
    }

    return {
      id,
      ...partitionsObj[id]
    };
  },

  /**
   * Updates a partitions meta and context.
   * This replaces the context and meta objects
   * @param {String} id The partition id
   * @param {Object} context The context of partition
   * @param {Object} meta The meta of partition
   * @returns {Object|undefined} The updated object. undefined, on failure.
   */
  async updateOne (id, context, meta) {
    // Bail out if the id is either empty or not a string
    if (_.isEmpty(id) || !_.isString(id)) {
      return;
    }

    // Bail out if the partition id is not valid
    if (_.isEmpty(await this.findOne(id))) {
      return;
    }

    const partitionsObj = await getPartitionsValue();

    partitionsObj[id] = { context, meta };
    await setPartitionsValue(partitionsObj);

    return {
      id,
      ...partitionsObj[id]
    };
  },

  /**
   * Removes partition and wipes the partition's storage.
   * @param {String} id, the partition id for which the session needs to cleaned.
   * @returns {Promise<String>} Promise resolving to the partition id cleaned. Rejects on invalid id.
   */
  async cleanOne (id) {
    // Bail out if the id is either empty or not a string
    if (_.isEmpty(id) || !_.isString(id)) {
      return Promise.reject(new Error('Please provide a valid partititon id to clean'));
    }

    // Bail out if the partition id is not valid
    if (_.isEmpty(await this.findOne(id))) {
      return Promise.reject(new Error('Partition id is not tracked'));
    }
    await this.makeOrphan([id]);

    return cleanPartitionStorage(id);
  },

  /**
   * Removes the specified list of partitions mapping from partition system
   * @param {String[]} partitionIdsList The partition id list to be removed
   * @returns {Void}
   */
  async removePartitionEntries (partitionIdsList) {
    // Bail out if the partitions list is empty not available.
    if (_.isEmpty(partitionIdsList) || !_.isArray(partitionIdsList)) {
      return;
    }

    let partitionsObj = await getPartitionsValue();

    // removes the partition from the v8 partitions object.
    partitionsObj = _.omit(partitionsObj, partitionIdsList);
    return setPartitionsValue(partitionsObj);
},

  /**
   * Updates the namespace level meta object
   * This replaces the entire meta object
   * @param {String} namespace
   * @param {Object} meta
   * @returns {Object} The updated namespace meta
   */
  async updateNamespaceMeta (namespace, meta) {
    // Bail out if namespace is either empty or not a string
    if (_.isEmpty(namespace) || !_.isString(namespace)) {
      return;
    }

    const globalMeta = await getGlobalMetaValue();

    globalMeta[namespace] = meta;
    await setGlobalMetaValue(globalMeta);

    return globalMeta[namespace];
  },

  /**
   * Gets the namespace level meta data
   * @param {String} namespace The namespace is used to group partitions
   * @return {Object} The namespace level meta object
   */
  async getNamespaceMeta (namespace) {
    // Bail out if namespace is either empty or not a string
    if (_.isEmpty(namespace) || !_.isString(namespace)) {
      return;
    }

    const globalMeta = await getGlobalMetaValue();

    return globalMeta[namespace];
  }
};

module.exports = partitionService;
