const _ = require('lodash'),
  users = require('./users'),
  partitions = require('./partitions'),
  shellUtils = require('./shellUtils');

var shellController = {

  /**
   * Holds the whole reference of the partitions.
   */
  partitions: partitions,

  /**
   * Holds the whole reference of the users.
   */
  users: users,

  /**
   * It is been called to initialize the partitions and users defaults from the localstorage
   */
  async init () {
    await this.partitions.init();
    await this.users.init();
    await this.runIntegrity();

    pm.logger.info('shellController~init: Success');
  },

  /**
   * runIntegrity will run on the data we have,
   * we are considering the partitions as the source of truth here and removing the extra users
   * 1. gets the userId in partitions
   * 2. remove the other users from the users map.
   */
  async runIntegrity () {

    // runs integrity
    let partitionsMap = await this.partitions.getValue(),
        associatedUsers = _.map(_.values(partitionsMap), 'userId'),
        usersList = _.keys(await this.users.getValue());

    await this.users.removeUsers(_.difference(usersList, associatedUsers));
  },

  /**
   * associateUserAndPartition
   * This been used to do the following things.
   * 1. Add the user to the users dataset
   * 2. Associate partition to the user
   * 3. Associate user to the partition
   * @param {Object} userData the userData to be associated
   */

  associateUserAndPartition (userData, partitionId) {
    let userId = shellUtils.getUserIdfromData(userData);

    // Bail out if,
    // 1. is not a logged in user
    // 2. Empty partitionId
    if (!shellUtils.isUserLoggedIn(userId) || _.isEmpty(partitionId)) {
      return;
    }

    // Add the user information first.
    this.users.addUser(userData);

    // Associate the parttion -> the user
    this.users.associatePartitionToUser(userId, partitionId);

    // Associate the user -> the partition
    this.partitions.associateUserToPartition(partitionId, userId);
  },

  /**
   * disAssociateUserAndPartition
   * This been used to do the following things.
   * 1. remove the user to the users dataset
   * 2. dis-associate partition to the user
   * 3. dis-associate user to the partition
   * @param {String} userId the user id for which the disassociation needs to be happen
   */

  disAssociateUserAndPartition (userData) {
    let userId = shellUtils.getUserIdfromData(userData),
        partitionId = this.getPartitionForUser(userId);

    // Bail out if,
    // 1. is not a logged in user
    // 2. Empty partitionId
    if (!shellUtils.isUserLoggedIn(userId) || _.isEmpty(partitionId)) {
      return;
    }

    // dis-associate the user -> the partition
    this.partitions.disAssociateUserToPartition(partitionId, userId);

    // remove the user information first.
    this.users.removeUser(userId);

  },

  /**
   * proxies the getNewPartition from the partitions module
   * @return {UUID} partition id
   */

  getNewPartition () {
    return this.partitions.getNewPartition();
  },

  /**
   * It gets the recent loggedin user from the users.
   * return {String=} userId of the recent user or null.
   */

  getRecentUser () {
    let usersMap = this.users.getValue(); // Get the update user value to switch to new user.

    // If the hash has users available to switch,
    if (!_.isEmpty(usersMap)) {
      return this.users.getRecentUser();
    }

    // if the map is empty, return null.
    return null;
  },


  /**
   * getUsers
   * Used to get the users from the cache
   * @return {Object} users object
   */

  getUsers () {
    return this.users.getValue();
  },

  /**
   * getPartitionForUser
   * It is used to get the partitionId associated with the user
   * @param {String} id the user_id for which the partition needs to be provided.
   * @return {UUID=} the uuid of the partition associated with the user, if no partition is provided it returns undefined.
   */

  getPartitionForUser (id) {
    return this.users.getPartitionForUser(id) || this.partitions.getNewPartition();
  }

};

module.exports = shellController;
