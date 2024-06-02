const _ = require('lodash'),
  dbService = require('./dbService');

const uuidV4 = require('uuid/v4'),
  DB_KEY = 'partitions',
  DEFAULT_PARTITION = 'default';

var partitions = {

  /**
   * Initialize function which loads the partitions information from localStorage.
   */
  async init () {
    this.setValue(await dbService.getData(DB_KEY));
  },

  /**
   * getValue
   * Getter function for the value property.
   * @return {Object} the cloned localstorage
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
   * getNewPartition
   * 1. Will check for any empty partition available
   * 2. If a empty partition available, it returns it
   * 3. Else it creates a new partitionId(UUID)
   * 4. Adds the entry in the localStorage
   * 5. send the ID for work.
   * @return {UUID} partitionId
   */
  async getNewPartition () {
    let partitionsObj = await this.getValue(),
        emptyPartition = _.findKey(partitionsObj, (part) => { return _.isEmpty(part.userId); });

    if (!_.isEmpty(emptyPartition)) {
      // returns an existing empty partition.
      return emptyPartition;
    }

    // Reaching here means there is no empty partitions available.
    // so, we are going to create one and adds to the storage.

    let newPartitionId = _.isEmpty(partitionsObj) ? DEFAULT_PARTITION : uuidV4();
    partitionsObj[newPartitionId] = { id: newPartitionId };

    // updates the value
    await this.setValue(partitionsObj);

    // Returns the new partitionId
    return newPartitionId;
  },

  /**
   * associateUserToPartition is been used to associate an user id with a partition.
   * @param {String} id the UUID of the partition
   * @param {String} userId user id to which the partition to be associated.
   */
  async associateUserToPartition (id, userId) {
    let userIdStr = _.toString(userId);

    // Bail out if the userId or id is not available.
    if (!isUserLoggedIn(userIdStr) || _.isEmpty(id)) {
      return;
    }

    // Get the partitions available.
    let partitionsObj = await this.getValue();

    // Associate the userId by adding userId property to partition object.
    if (!_.isEmpty(partitionsObj[id])) {
      _.assign(partitionsObj[id], { userId: userIdStr });
    }

    // updates the value
    await this.setValue(partitionsObj);
  },


  /**
   * disAssociateUserToPartition is been used to dis-associate an user id with a partition.
   * @param {UUID} id the UUID of the partition
   * @param {String} userId user id from which the partition to be dis-associated.
   */
  async disAssociateUserToPartition (id, userId) {
    let userIdStr = _.toString(userId);

    // Bail out if the userId or id is not available.
    if (!isUserLoggedIn(userIdStr) || _.isEmpty(id)) {
      return;
    }

    // Get the partitions from the localStorage using dbService.getData.
    let partitionsObj = await this.getValue();

    // Dis-associate the userId by removing userId property from partition object.
    if (!_.isEmpty(partitionsObj[id])) {
      partitionsObj[id] = _.omit(partitionsObj[id], ['userId']);
    }

    // Updates the value
    await this.setValue(partitionsObj);
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

module.exports = partitions;
