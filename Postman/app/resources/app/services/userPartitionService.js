const _ = require('lodash'),
  partitionService = require('./partitionService'),
  shellController = require('./shellController'),
  partitionMigrationService = require('./partitionMigrationService'),
  partitionUtils = require('./partitionUtils'),
  shellMeta = require('./shellMeta');

const namespace = 'users',
  scratchpadContext = { namespace: 'scratchPad', userId: 0, teamId: 0 },
  { session } = require('electron'),
  regionsMetaNamespace = 'regionsMeta';


/**
* Wipes out the associated cookie partition's storage.
* @param {UUID} id, the partition id  whose associated cookie session needs to cleaned.
* @returns {Promise<String>}
*/
function cleanCookiePartitionAssociated (id) {
  // Bail out if the id is either empty or not a string
  if (_.isEmpty(id) || !_.isString(id)) {
    return Promise.reject(new Error('Partition id is not valid string'));
  }

  const cookiePartitionId = partitionUtils.getCookiePartitionId(id),
    partitionSession = session.fromPartition(cookiePartitionId);

  return partitionSession.clearStorageData()
    .then(() => {
      return id;
    });
}

/**
 * Gets the list of logged in user context partitions on v8 partition system
 * @returns {Object[]} Array of logged in user context partitions on v8 partition system
 */
async function getAllV8UserContextPartitions () {
  const context = { namespace },
    partitions = await partitionService.find(context),
    v8UserContextPartitions = [];

  _.forEach(partitions, (partition) => {
    partition.context && partition.context.userId && v8UserContextPartitions.push({
      partitionId: partition.id,
      id: partition.context && partition.context.userId,
      teamId: partition.context && partition.context.teamId,
      name: partition.meta && partition.meta.name,
      email: partition.meta && partition.meta.email,
      username: partition.meta && partition.meta.username,
      profile_pic_url: partition.meta && partition.meta.profile_pic_url,
      lastUpdated: partition.meta && partition.meta.lastUpdated,
      auth: partition.meta && partition.meta.auth,
      region: partition.context && partition.context.region
    });
  });

  return v8UserContextPartitions;
}

/**
 * Gets the list of logged in user context partitions on v7 partition system
 * @returns {Object[]} Array of logged in user context partitions on v7 partition system
 */
async function getAllV7UserContextPartitions () {
  const v7UserContextPartitions = [],
    v7UsersObj = await shellController.getUsers();

  await Promise.all(Object.values(v7UsersObj).map((user) => {
    // If the partition is migrated, it can be found in v8
    return partitionService.findOne(user.partitionId)
      .then((isV8Partition) => {
        if (isV8Partition) {
          return;
        }

        v7UserContextPartitions.push(user);
      });
  }));

  return v7UserContextPartitions;
}


/**
 * Gets the least recently used v8 user context partition
 * @returns {String | undefined} Returns the partition id by comparing the v8 partition's last accessed timestamp
 */
async function getRecentV8UserPartition () {
  const partitions = await getAllV8UserContextPartitions();

  // Bail out, if there is nothing
  if (_.isEmpty(partitions)) {
    return;
  }

  // Pick the partition id of recently accessed partition of user
  const recentPartition = _.maxBy(partitions, (partition) => { return partition.lastUpdated; }),
    recentPartitionId = recentPartition && recentPartition.partitionId;

  pm.logger.info('userPartitionService~getRecentV8UserPartition: recent v8 user context partition ', recentPartitionId);

  return recentPartitionId;
}

/**
 * @returns {String} The partition id of v7 last active user if it is not yet migrated
 */
async function getV7ActiveUserPartitionIfNotYetMigratedToV8 () {
  const recentV7UserId = shellMeta.getLastActiveUser();

  if (_.isEmpty(recentV7UserId)) {
    return;
  }

  const recentV7UserPartitionId = await shellController.users.getPartitionForUser(recentV7UserId);

  if (_.isEmpty(recentV7UserPartitionId)) {
    return;
  }

  // if the same partition exists on v8, even though it's active on v7, we don't return that
  if (!_.isEmpty(await partitionService.findOne(recentV7UserPartitionId))) {
    return;
  }
  pm.logger.info('userPartitionService~getV7ActiveUserPartitionIfNotYetMigratedToV8: v7 active user context partition which is not yet migrated to v8', recentV7UserPartitionId);

  return recentV7UserPartitionId;
}

const userPartitionService = {
  async init () {
    await partitionMigrationService.init();
    await partitionMigrationService.runV8PartitionsIntegrity();
    await this._rectifyTheActivePartitionOfApplication();

    /**
     * Migrate signed-out partition from v7 to v8
     * Signed-out partition can be created two ways on v7:
     * 1. When the app has no signed-in account
     * 2. When the user has signed-in but while adding a new account the app got quit
     * (v7 app does not self-correct this state and the user ends up being on signed-out exp.
     * We are making sure that even that partition is migrated as scratchpad :) )
     */
    await partitionMigrationService.migrateSignedOutPartitionAsScratchpad();
    pm.logger.info('userPartitionService~init: Success');
  },

  /**
   * Logs v8 partition system state
   */
  async logV8PartitionSystemState () {
    pm.logger.info('userPartitionService: State of v8 partition system:');

    const printables = [],
      v8usersNamespacePartitions = await partitionService.find({ namespace }),
      v8ScratchpadNamespacePartitions = await partitionService.find(scratchpadContext);

    v8usersNamespacePartitions.forEach((v8Partition) => {
      printables.push({ partitionId: v8Partition.id, namespace: v8Partition.context.namespace, userId: v8Partition.context.userId, teamId: v8Partition.context.teamId, lastUpdated: v8Partition.meta.lastUpdated });
    });
    v8ScratchpadNamespacePartitions.forEach((scratchpadPartition) => {
      printables.push({ partitionId: scratchpadPartition.id, namespace: scratchpadPartition.context.namespace, userId: scratchpadPartition.context.userId, teamId: scratchpadPartition.context.teamId, isDirty: scratchpadPartition.meta.isDirty });
    });

    pm.logger.info('userPartitionService: List of partitions:', printables);
    pm.logger.info('userPartitionService: users global meta:', partitionService.getNamespaceMeta(namespace));
  },

  /**
   * When the app crashes or quit abruptly,
   * the active partition might hold either a transit partition
   * or an invalid partition.
   * We rectify the state of the app by setting it
   * to the recent user context partition or null
   *
   * And also,
   * if there is no user on v8, we pick the partition associated with the v7 last active user
   */
  async _rectifyTheActivePartitionOfApplication () {
    const recentV8UserPartition = await getRecentV8UserPartition() || await getV7ActiveUserPartitionIfNotYetMigratedToV8() || null;

    pm.logger.info('userPartitionService~_rectifyTheActivePartitionOfApplication: Setting the active partition to ', recentV8UserPartition);
    await this.setActivePartition(recentV8UserPartition);
  },

  /**
   * Checks if a partitionId is associated with a user on v7 system
   * @param {String} partitionId the partiiton id to check
   * @returns {Boolean}
   */
  isV7UserContextPartitionId (partitionId) {
    return partitionMigrationService.isV7UserContextPartition(partitionId);
  },

  /**
   * Checks if a partitionId is associated with a user on v8 system
   * @param {String} partitionId the partiiton id to check
   * @returns {Boolean}
   */
  async isV8UserContextPartitionId (partitionId) {
    if (!partitionId) {
      return false;
    }

    const v8Partition = await partitionService.findOne(partitionId);

    if (_.isEmpty(v8Partition) || _.isEmpty(v8Partition.context)) {
      return false;
    }

    return v8Partition.context.namespace === namespace;
  },

  /**
   * Gets the active partition used currently.
   * This includes the scratchpad partition as well.
   * @returns {String | undefined} Returns partition id. undefined, if there are no user partitions.
   */
  async getActivePartition () {
    const namespaceMeta = await partitionService.getNamespaceMeta(namespace);

    return namespaceMeta && namespaceMeta.activePartition;
  },

  /**
   * Saves the current partition in use, only if partition is associated with a user context
   * @param {String} partitionId The partition id to be saved
   * @returns {void} Does not return anything
   */
  async setActivePartition (partitionId) {
    const namespaceMeta = await partitionService.getNamespaceMeta(namespace) || {};

    namespaceMeta.activePartition = partitionId;
    await partitionService.updateNamespaceMeta(namespace, namespaceMeta);
  },

  // /**
  //  * Finds the parititon id associated with the provided user information in v7 and v8.
  //  * Returns the recently used partition, if there are multiple.
  //  * @param {Object} userData The object containing the user information including userId
  //  * @returns {String | undefined} The partition id associated, if available. undefined, otherwise.
  //  */
  async getPartitionForUser (userData) {
    // Bail out, if user id and team id are not available
    if (_.isEmpty(userData) || _.isEmpty(userData.id)) {
      return;
    }

    const context = {
        namespace,
        userId:
        userData.id
      },
      partitions = await partitionService.find(context),
      partitionsOfUser = [];

    _.forEach(partitions, (partition) => {
      partition.context && partition.context.userId && partitionsOfUser.push({
        partitionId: partition.id,
        lastUpdated: partition.meta && partition.meta.lastUpdated
      });
    });

    /**
     * Migration: Check if the user context is present in v7
     * The migration path to v8 will be hit, on switching user context
     */

    const v7PartitionId = await shellController.users.getPartitionForUser(userData.id);

    // If the partition is already migrated, it can be found in v8
    if (v7PartitionId && !partitionService.findOne(v7PartitionId)) {
      const partitionFromV7 = _.find(await shellController.getUsers(), { partitionId: v7PartitionId });

      if (partitionFromV7) {
        partitionsOfUser.push(partitionFromV7);
      }
    }

    // Pick the partition id of recently accessed partition of user
    const recentPartition = _.maxBy(partitionsOfUser, (partition) => { return partition.lastUpdated; }),
      recentPartitionId = recentPartition && recentPartition.partitionId,
      partitionToBeUpdated = await partitionService.findOne(recentPartitionId);

    // if we found found the partition in v8, we need to update the lastUpdated timestamp
    if (_.isEmpty(partitionToBeUpdated)) {
      return recentPartitionId;
    }

    // Update the access time of the partition
    partitionToBeUpdated.meta.lastUpdated = new Date();
    await partitionService.updateOne(recentPartitionId, partitionToBeUpdated.context, partitionToBeUpdated.meta);

    return recentPartitionId;
  },

  /**
   * Finds the partition id associated with the provided user information.
   * @param {Object} userData The object containing the user information including userId
   * @returns {String | undefined} The partition id associated, if available. undefined, otherwise.
   */
  async getPartitionForUserContext (userData) {
    // Bail out, if user id and team id are not available
    if (_.isEmpty(userData) || _.isEmpty(userData.id) || _.isEmpty(userData.teamId)) {
      return;
    }

    const partitionDetails = {
        isV8Partition: true,
        partitionId: null
      },
      context = {
        namespace,
        userId: userData.id,
        teamId: userData.teamId,
        region: userData?.region
      },
      partitions = await partitionService.find(context);

    if (_.isEmpty(partitions)) {
      // Check if the partition is available in v7
      const v7PartitionId = await shellController.users.getPartitionForUser(userData.id);

      if (!v7PartitionId) {
        return;
      }

      // If the partition is migrated, it can be found in v8
      // this means that the same partition exists on v8 but with different teamId
      if (await partitionService.findOne(v7PartitionId)) {
        return;
      }

      partitionDetails.isV8Partition = false;
      partitionDetails.partitionId = v7PartitionId;

      return partitionDetails;
    }

    // Update the access time of the partition
    partitions[0].meta.lastUpdated = new Date();
    await partitionService.updateOne(partitions[0].id, partitions[0].context, partitions[0].meta);

    // There will be only one partition associated with <user, team> tuple
    partitionDetails.partitionId = partitions[0].id;


    return partitionDetails;
  },

  /**
   * Associate a partition with the provided user data.
   * @param {String} partitionId The partition id
   * @param {Object} userData The Object containing userId and teamId
   * @returns {void}
   */
  async associatePartitionToUserData (partitionId, userData) {
    if (!partitionId) {
      return;
    }

    // Bail out, if user id and team id are not available
    if (_.isEmpty(userData) || !_.isString(userData.id) || !_.isString(userData.teamId) || userData.id === '0') {
      return;
    }

    const context = {
        namespace,
        userId: userData.id,
        teamId: userData.teamId,
        region: userData?.region
      },
      meta = {
        lastUpdated: new Date(),
        name: userData.name,
        email: userData.email,
        username: userData.username,
        profile_pic_url: userData.profile_pic_url,
        auth: userData.auth,

        // Used by Web Platform,
        // We are saving the JSON string for two reasons:
        // 1. partitionService will not save and return nested objects such as userData.auth
        // 2. we retain the same structure as being used in Monolith, so no data transformation is needed
        //    and we also get new fields which might be added to the object in future (such as `locale`)
        raw: JSON.stringify(userData),
      };

    pm.logger.info('userPartitionService~associateTransitPartition: ', { partitionId, context });
    await partitionService.makeRawPartition(partitionId, context, meta);

    // Set multi-login token in the meta.
    await this.setMultiLoginToken(userData?.region, userData?.auth?.multi_login_token);

    this.logV8PartitionSystemState();
  },

  /**
  //  * Creates a partition for the provided user data.
  //  * @param {Object} userData The Object containing userId and teamId
  //  * @returns {Promise<String>} Promise resolving to the partition id.
  //  */
  async associateTransitPartition (userData) {
    const partitionId = await this.getNewPartitionId();

    await this.associatePartitionToUserData(partitionId, userData);
    return partitionId;
  },

  /** Creates a transit partition which will be associated with a user context on login
   * @returns {Promise<String>} Promise resolving to a partition id
  */
  async getNewPartitionId () {
    const context = {
      namespace,
      userId: 0,
      teamId: 0
    };

    pm.logger.info('userPartitionService~getNewPartitionId: creating a partition with userId and teamId as 0');
    const partition = await partitionService.create(context, { lastUpdated: new Date() });
    return partition.id;
  },

  /**
   * Gets the list of logged in user context partitions
   * @returns {Object[]} Array of logged in user context partitions
   */
  async getAllUserContextPartitions () {
    const userContextPartitions = [];

    return userContextPartitions.concat(await getAllV8UserContextPartitions(), await getAllV7UserContextPartitions());
  },

  /**
   * @returns {Object[]} Array of distinct user accounts
   */
  async getAllUsers () {
    let userIdMap = {},
      users = [],
      allContextPartitions = await this.getAllUserContextPartitions();

    allContextPartitions.forEach((partition) => {
      if (!userIdMap[partition.id]) {
        userIdMap[partition.id] = partition;

        users.push({
          id: partition.id,
          name: partition.name,
          email: partition.email,
          username: partition.username,
          profile_pic_url: partition.profile_pic_url,
          region: partition.region
        });
      }
    });

    return users;
  },

  /**
   * Gets the least recently used partition across v7 and v8
   * @returns {String|undefined} Returns the partition id by comparing the partition's last accessed timestamp
   */
  async getRecentPartition () {
    const partitions = await this.getAllUserContextPartitions();

    // Bail out, if there is nothing
    if (_.isEmpty(partitions)) {
      return;
    }

    // Pick the partition id of recently accessed partition of user
    const recentPartition = _.maxBy(partitions, (partition) => { return partition.lastUpdated; }),
      recentPartitionId = recentPartition && recentPartition.partitionId;

    return recentPartitionId;
  },

  /**
   * Cleans All the partitions associated with the provided user id.
   * Also cleans the cookie partitions associated, which are used by runtime.
   * @param {String} userId The user id whose associated partitions have to be cleaned.
   * @returns {Promise<void>} Returns a promise, which resolve after trying to clean all the partitions
   */
  async cleanPartitionsOfUser (userId) {
    // Bail out, if no user id is provided
    if (_.isEmpty(userId)) {
      // Nothing to do
      return;
    }

    const context = {
        namespace,
        userId
      },
      partitions = await partitionService.find(context);

    // Bail out, if there is nothing to clean
    if (_.isEmpty(partitions)) {
      return;
    }

    const cleanPromises = [];

    _.forEach(partitions, (partition) => {
      cleanPromises.push(partitionService.cleanOne(partition.id));
      cleanPromises.push(cleanCookiePartitionAssociated(partition.id));
    });

    return Promise.allSettled(cleanPromises)
      .then(() => {
        return;
      });
  },

  /**
   * Get user and team ID details for active partition
   *
   * @returns {{
   *    userId: string;
   *    teamId: string;
   *    region: 'eu' | 'us'
   * }} User details from active partition or undefined if partition / context not found
   */
  async getUserContextForActivePartition () {
    const activePartitionId = await this.getActivePartition(),
      activePartition = await partitionService.findOne(activePartitionId);

    // Bail out, if active partition details doesn't exist
    if (!activePartition || !activePartition.context) {
      return;
    }

    const { userId, teamId, region } = activePartition.context ?? {};
    return { userId, teamId, region };
  },

  /**
   * Stores the multi login token in the metadata for a specific region.
   *
   * @param {string} region - The region for which the multi login token will be stored.
   * @param {string} multiLoginToken - The multi login token to be stored.
   */
  async setMultiLoginToken (region, multiLoginToken) {
    if (!multiLoginToken || !region) {
      return;
    }

    const regionsMetaData = await partitionService.getNamespaceMeta(regionsMetaNamespace) || {};

    _.set(regionsMetaData, `${region}.multiLoginToken`, multiLoginToken);
    await partitionService.updateNamespaceMeta(regionsMetaNamespace, regionsMetaData);
  },

  /**
   * Retrieves the multi login token associated with the specified region.
   *
   * @param {string} region - The region for which to retrieve the multi login token.
   * @returns {string} - The multi login token associated with the region.
   * @throws {Error} - If an error occurs while retrieving the multi login token.
   */
  async getMultiLoginToken (region) {
    if (!region) {
      return;
    }

    const namespaceMeta = await partitionService.getNamespaceMeta(regionsMetaNamespace) || {};

    return _.get(namespaceMeta, `${region}.multiLoginToken`);
  }
};

module.exports = userPartitionService;

