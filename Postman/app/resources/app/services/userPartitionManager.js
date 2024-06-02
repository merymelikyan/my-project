const _ = require('lodash'),
  scratchPadPartitionService = require('./scratchPadPartitionService'),
  userPartitionService = require('./userPartitionService');

let _shouldVerifyTeamIdOfCurrentPartitionMap = new Map(),
  recentlyAuthenticatedUserDataMap = new Map();

/**
 *
 */
function handlePartitioning (authResponse) {
  const action = _.get(authResponse, ['authData', 'additionalData', 'action']),
    userData = _.get(authResponse, ['authData', 'userData']);

  return Promise.resolve()
    .then(() => {
      switch (action) {
        case 'signup':
        case 'login':
          return loginUser(userData);
        case 'switch':
          return switchUser(userData.id);
        case 'logout':
          return logoutUser(userData);
        case 'skip':
        default:
          return getPartitionToLoad();
      }
    });
}

/**
 *
 */
async function loginUser (userData) {
  // Bail out, if user id and team id are not available
  if (_.isEmpty(userData) || _.isEmpty(userData.id) || _.isEmpty(userData.teamId)) {
    throw new Error('Invalid user data - The user data should contain user id and team id');
  }

  // get the userId from the data.
  const existingPartitionDetails = await userPartitionService.getPartitionForUserContext(userData);

  let partitionId;

  // // This means logging into the already logged in account
  if (!_.isEmpty(existingPartitionDetails)) {
    pm.logger.info('Shell~init~loginUser: Updating existing user details');
    await userPartitionService.associatePartitionToUserData(existingPartitionDetails.partitionId, userData);
    await userPartitionService.setActivePartition(existingPartitionDetails.partitionId);

    partitionId = existingPartitionDetails.partitionId;
  }
  else {
    pm.logger.info('Shell~init~loginUser: associating the user ', userData.id, ' with transit partition');
    const newPartitionId = await userPartitionService.associateTransitPartition(userData);

    partitionId = newPartitionId;
    await userPartitionService.setActivePartition(partitionId);
  }

  _shouldVerifyTeamIdOfCurrentPartitionMap.set(partitionId, existingPartitionDetails && !existingPartitionDetails.isV8Partition);
  recentlyAuthenticatedUserDataMap.set(partitionId, userData);

  return partitionId;
}

/**
 *
 * @param {*} userId
 * @returns
 */
async function switchUser (userId) {
  if (_.isEmpty(userId)) {
    throw new Error('Invalid user id');
  }
  pm.logger.info('Shell~init~switchUser: switching to user ', userId);
  const partitionId = await userPartitionService.getPartitionForUser({ id: userId });

  if (_.isEmpty(partitionId)) {
    throw new Error('There is no partition associated with the provided user');
  }
  await userPartitionService.setActivePartition(partitionId);

  return partitionId;
}

/**
 * We need to do the following things to remove a user.
 * 1. clean all partitions associated with the user
 * 2. make the cleaned partitions available
 * 3. update the active partition
 * @param {object} userData the user data to be removed from tracking
 * @returns {Promise<partitionId>} The recent user context partition if present or scratchpad partition
 */
async function logoutUser (userData) {
  pm.logger.info('Shell~init~logoutUser', userData);
  await userPartitionService.cleanPartitionsOfUser(userData.id);

  const partitionId = await userPartitionService.getRecentPartition();

  if (!partitionId) {
    // Setting active partition to be null, as there are no user context partitions
    await userPartitionService.setActivePartition(null);
    pm.logger.info('Shell~init~logoutUser: There is no user contexts anymore, falling back to scratchpad');
    return scratchPadPartitionService.getCurrent();
  }

  await userPartitionService.setActivePartition(partitionId);

  return partitionId;
}

/**
 *
 * @returns
 */
async function getPartitionToLoad () {
  // Log the state of v8 partition system
  userPartitionService.logV8PartitionSystemState();

  const activePartition = await userPartitionService.getActivePartition();

  if (activePartition) {
    pm.logger.info('shell~init~getPartitionToLoad: loading active partition');
    return activePartition;
  }

  pm.logger.info('shell~init~getPartitionToLoad: loading scratchpad partition');
  return scratchPadPartitionService.getCurrent();
}

/**
 *
 * @returns
 */
async function migrateV7User (userInfo) {
  const { windowManager } = require('./windowManager'),
    activePartitionId = await userPartitionService.getActivePartition(),
    isV8UserContextPartitionId = await userPartitionService.isV8UserContextPartitionId(activePartitionId),
    isV7UserContextPartitionId = await userPartitionService.isV7UserContextPartitionId(activePartitionId),
    isScratchPadPartitionId = await scratchPadPartitionService.isScratchPadPartitionId(activePartitionId);

    pm.logger.info('Shell~init~migrateV7User: Received user context from requester web view', { userId: userInfo.id, teamId: userInfo.teamId });

    if (isV7UserContextPartitionId && !isV8UserContextPartitionId) {
      await userPartitionService.associatePartitionToUserData(activePartitionId, userInfo);

      let recentlyAuthenticatedUserData = recentlyAuthenticatedUserDataMap.get(activePartitionId);

      // When partition is from V7 system and user authenticated a user context,
      // The newly associated partition will be loaded again if the teamId does not match
      if (
        _shouldVerifyTeamIdOfCurrentPartitionMap.get(activePartitionId) && !_.isEmpty(recentlyAuthenticatedUserData)
        && (recentlyAuthenticatedUserData.teamId !== userInfo.teamId || recentlyAuthenticatedUserData.id !== userInfo.id)
        ) {
          pm.logger.info('Shell~init~migrateV7User: the team id received from requester web view is not same as authenticated team id');
          userPartitionService.associateTransitPartition(recentlyAuthenticatedUserData)
          .then((newPartitionId) => {
            userPartitionService.setActivePartition(newPartitionId);

            // Reset the flag
            _shouldVerifyTeamIdOfCurrentPartitionMap.set(activePartitionId, false);
            windowManager.reLaunchRequesterWindows();
          });
        }
    }

    // When chromium does not persist partition data after login,
    // the user will be presented scratchpad banner but the data will be of user
    if (isScratchPadPartitionId) {
      if (userInfo.id !== '0') {
        await userPartitionService.associatePartitionToUserData(activePartitionId, userInfo);

        // Reload the web view, as the association of the same partition has changed
        // We are switching the same partition in order to reload all windows (there can be multiple windows with the same webview)
        return windowManager.reLaunchRequesterWindows();
      }
    }
}

/**
   * updateCurrentUserPartition
   * updates meta data of a user partition on every login, signup or account switch
   * @param {Object} oldUserContext - required for identifying the correct partition to update
   * @param {String} oldUserContext.id
   * @param {String} oldUserContext.teamId
   * @param {Object} newUserData
   * @param {String} newUserData.id
   * @param {String} newUserData.teamId
   * @param {String} [newUserData.name]
   * @param {String} [newUserData.email]
   * @param {String} [newUserData.username]
   * @param {String} [newUserData.profile_pic_url]
   * @param {Object} [newUserData.auth]
   * @returns {Object} Returns the updated partition for current user
   */
 async function updateCurrentUserPartition (oldUserContext, newUserData) {

  // early bailout, if user and team ids are not present in old and new contexts
  if (_.isEmpty(oldUserContext.id) || _.isEmpty(oldUserContext.teamId) || _.isEmpty(newUserData.id) || _.isEmpty(newUserData.teamId)) {
    return;
  }
  const partitionForUserContext = await userPartitionService.getPartitionForUserContext(oldUserContext),
    currentActivePartitionId = await userPartitionService.getActivePartition();

  // bailout if current active partition does not belong to bootstrapped user
  if (_.isEmpty(partitionForUserContext) || currentActivePartitionId !== _.get(partitionForUserContext, 'partitionId')) {
    return;
  }

  return userPartitionService.associatePartitionToUserData(currentActivePartitionId, { ...newUserData });
}

/**
 *
 */
async function getActiveUser () {
  const userContexts = await userPartitionService.getAllUserContextPartitions(),
    hasUserContexts = userContexts.length > 0;

  if (!hasUserContexts) {
    return;
  }

  const currentUser = _.find(userContexts, { partitionId: await userPartitionService.getActivePartition() });

  if (!currentUser || currentUser.id === 0) { return; }

  return _.pick(currentUser, ['email', 'id', 'teamId', 'name', 'username']);
}


module.exports = {
  handlePartitioning,
  migrateV7User,
  updateCurrentUserPartition,
  getActiveUser
};
