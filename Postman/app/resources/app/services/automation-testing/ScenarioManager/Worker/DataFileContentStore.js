/* eslint-disable no-console */
const _ = require('lodash');
const { DATAFILE_RANDOM_DISTRIBUTION } = require('../../ScenarioManager/constants');

/**
 * @typedef VUData
 *
 * @property {Array<String>} keys - The keys of the data file
 * @property {Array<{ key: string, value: string|number|boolean }>} data - The data of the data file
 * @property {Array<Number>} sliceIndices - Reference to the data file rows that are assigned to the VU
 * @property {Boolean} randomize - Whether the data file rows have to be randomized
 */

/**
 * This class is responsible for storing, refreshing and maintaining the data file content and providing it to the
 * VU execution.
 */
class DataFileContentStore {
  VUData = null;
  parentPort = null;
  #readsSinceLastUpdate = 0;
  #isRefreshing = false;
  #enableRefresh = false;
  #workloadId = null;

  /**
   * @param {VUData} VUData - The VUData object
   * @param {Object} parentPort - The parent port to communicate with the parent thread
   */
  constructor (VUData, parentPort) {
    this.VUData = VUData;
    this.parentPort = parentPort;
  }

  /**
   * Returns the variables from the VUData object along with the data file row index
   *
   * @returns {
   *  {
   *   dataFileRowIndex: Number,
   *   variables: Array<{key: string, value: *}>
   *  }|{ dataFileRowIndex: undefined, variables: undefined }
   * } - Object containing dataRowIndex and variablesToInject
   */
  getRunData = () => {
    this.#readsSinceLastUpdate += 1;

    // Refresh the store's VUData object after every REFRESH_DATA_INTERVAL reads such that the VUData can be randomized
    // across iterations of a scenario and across assignments inside a worker thread
    if (!(this.#readsSinceLastUpdate % DATAFILE_RANDOM_DISTRIBUTION.REFRESH_DATA_INTERVAL)) {
      // If there is some error while refreshing the VUData, log it and continue with the existing VUData
      this.#refreshVUData().catch((err) => {
        console.error('Error while refreshing VUData', err);
      });
    }

    let dataFileRowIndex, variables;

    if (this.VUData?.keys) {
      // Pick a random index of dataVariables.sliceIndices
      const vuSliceIndexToDataFileRowIndex = _.random(_.range(this.VUData.sliceIndices.length));

      // Get reference of the selected index wrt to datafile
      dataFileRowIndex = this.VUData.sliceIndices?.[vuSliceIndexToDataFileRowIndex];

      // If there is no data for the given index, return an object with null values
      // This would happen in conditions where the data file is smaller than the number of VUs
      variables = this.VUData.data?.[vuSliceIndexToDataFileRowIndex] || this.VUData.keys.reduce((acc, key) => {
        acc[key] = null;
        return acc;
      }, {});
    }

    return {
      isRowOutOfBound: !Number.isInteger(dataFileRowIndex),
      dataFileRowIndex,
      variables
    };
  }

  /**
   * Updates the VUData object with the new data
   *
   * @param {Object} VUData - The VUData object
   */
  updateVUData = (VUData) => {
    this.VUData = VUData;
    this.#readsSinceLastUpdate = 0;
    this.#isRefreshing = false;
  }

  /**
   * Refreshes the VUData object
   * @private
   * @returns {Promise<void>}
   */
  #refreshVUData = async () => {
    if (this.#isRefreshing || !this.#enableRefresh) {
      return;
    }

    this.#isRefreshing = true;
    this.#readsSinceLastUpdate = 0;

    this.parentPort.postMessage({
      type: 'request',
      data: {
        requestType: 'refreshVUData',
        workloadId: this.#workloadId
      }
    });
  }

  /**
   * Enables the refresh of the VUData object for a given workload
   * @public
   *
   * @param {String} workloadId - The workload id for which the refresh is enabled
   *
   * @returns {void}
   */
  enableRefresh = (workloadId) => {
    if (this.#enableRefresh || this.#workloadId) {
      throw new Error('DataFileContentStore: Refresh is already enabled for another workload');
    }

    this.#enableRefresh = true;
    this.#workloadId = workloadId;
  }
}

module.exports = DataFileContentStore;
