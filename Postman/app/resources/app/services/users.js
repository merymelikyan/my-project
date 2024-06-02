const _ = require('lodash'),
  dbService = require('./dbService'),
  DB_KEY = 'users';

var users = {

  /**
   * Initialize function which loads the users information from localStorage.
   */
  async init () {
    this.setValue(await dbService.getData(DB_KEY));
    this.modelEventBus = pm.eventBus.channel('model-events');
  },

  /**
   * getValue
   * Getter function for the value property.
   * @return {Object} the localStorage value
   */
  getValue () {
    return dbService.getData(DB_KEY);
  },

  /**
   * setValue
   * Setter function for the value property.
   * @param {Object} obj The object to be set to the value property.
   */
  async setValue (obj) {
    // Update the localStorage on the changes made.
    await dbService.setData(DB_KEY, obj);
  },

  /**
   * associatePartitionToUser
   * @param {String} id the user id to which the partition needs to be associated
   * @param {UUID} partitionId the partition id which needs to be associated with the user
   */
  async associatePartitionToUser (id, partitionId) {
    let idStr = _.toString(id);

    // Bail out if the id or partitionId is not available.
    if (!isUserLoggedIn(idStr) || _.isEmpty(partitionId)) {
      return;
    }

    // Get the users available.
    let usersObj = await this.getValue();

    // Associate the partitionId by adding partitionId property to user object.
    if (!_.isEmpty(usersObj[idStr])) {
      _.assign(usersObj[idStr], { partitionId });
    }

    // updates the value
    await this.setValue(usersObj);

    this.modelEventBus.publish(createEvent('updated', 'users', usersObj, null, { updatedKeys: ['partitionId'] }));
  },

  /**
   * getPartitionForUser
   * It is used to get the partitionId associated with the user
   * @param {String} id the user_id for which the partition needs to be provided.
   * @return {UUID=} the uuid of the partition associated with the user, if no partition is provided it returns undefined.
   */

  async getPartitionForUser (id) {
    let value = await this.getValue();
    return _.get(value, [_.toString(id), 'partitionId']);
  },

  /**
   * getRecentUser
   * get the recently added user sorted using the lastUpdated time
   * @return {String} user_id of the user whom needs to be switched to.
   */
  async getRecentUser () {
    let usersObj = await this.getValue();
    return _.get(_.minBy(_.values(usersObj), (user) => { return user.lastUpdated; }), 'id');
  },

  /**
   * addUser
   * adds the user to the data set and also includes the lastUpdated time for it.
   * @param {Object} data the user data to be added with the hash
   */

  async addUser (data) {
    // Move user_id to id if the id is not available.
    // Add last updated time key also.
    _.assign(data, !_.has(data, 'id') ? { id: data.user_id } : {}, { lastUpdated: new Date() });

    // Get the users available.
    let usersObj = await this.getValue();

    // adds the user from the users object.
    usersObj[data.id] = data;

    // updates the value
    await this.setValue(usersObj);

    this.modelEventBus.publish(createEvent('created', 'users', data));
  },

  /**
   * removeUser
   * Which ideally removes the user from the users list.
   * @param {String} id the user id to which the partition needs to be dis-associated
   */
  async removeUser (id) {
    let idStr = _.toString(id);

    // Bail out if the id is not available.
    if (!isUserLoggedIn(idStr)) {
      return;
    }

    // Get the users available.
    let usersObj = await this.getValue();

    // removes the user from the users object.
    usersObj = _.omit(usersObj, [idStr]);

    // updates the value
    await this.setValue(usersObj);

    this.modelEventBus.publish(createEvent('deleted', 'users', { id: idStr }));
  },

  /**
   * removeUsers
   * Which ideally removes the list of users from the users list.
   * @param {array} usersList the user id list which all to be removed.
   */

  async removeUsers (usersList) {
    // Bail out if the id is not available.
    if (_.isEmpty(usersList) || !_.isArray(usersList)) {
      return;
    }

    // Get the users available.
    let usersObj = await this.getValue();

    // removes the user from the users object.
    usersObj = _.omit(usersObj, usersList);

    // updates the value
    await this.setValue(usersObj);
  }
};

/**
 *
 * @param {*} id
 * @returns
 */
function isUserLoggedIn (id) {
  return !(_.isEmpty(id) || id === '0' || id === 0);
}

/**
 *
 */
function createEvent (name, namespace, data, events, meta) {
  // If the model or the actions are empty then it needs to error out.
  if (_.isEmpty(name) || _.isEmpty(namespace)) {
    throw new Error('ModelEvent: Cannot create event without name or namespace');
  }

  let event = { name, namespace };

  data && (event.data = data);
  events && (event.events = events);
  meta && (event.meta = meta);

  // returns the instruction POJO.
  return event;
}

module.exports = users;
