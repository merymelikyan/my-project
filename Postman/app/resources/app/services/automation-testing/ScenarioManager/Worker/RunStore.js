/**
 * Stores run objects for the runs going on in the thread.
 * @class RunStore
 */
class RunStore {
  /**
   * The map of runId to an object containing the run and additional data.
   */
  #runs = null;

  constructor () {
    this.#runs = new Map();
  }

  /**
   * Returns the run object for the given runId.
   *
   * @param {string} runId - The runId of the run object to return.
   *
   * @returns {Object} - The run object for the given runId.
   */
  get (runId) {
    return this.#runs.get(runId);
  }

  /**
   * Adds a run object to the store.
   *
   * @param {string} runId - The runId of the run object to add.
   * @param {Object} run - The run object to add.
   */
  add (runId, runData) {
    this.#runs.set(runId, runData);
  }

  /**
   * Updates the run of the given ID with a patch object and returns the updated object
   *
   * @param {string} runId - The runId of the run object to return.
   *
   * @returns {Object} - The updated run-data object for the given runId.
   */
  update (runId, patch) {
    const runData = this.#runs.get(runId);

    if (!runData) {
      throw new Error('No run found for runId', runId);
    }

    const patched = Object.assign(runData, patch);

    this.#runs.set(runId, patched);

    return patched;
  }

  /**
   * Removes a run object from the store.
   *
   * @param {string} runId - The runId of the run object to remove.
   */
  remove (runId) {
    this.#runs.delete(runId);
  }
}

module.exports = RunStore;
