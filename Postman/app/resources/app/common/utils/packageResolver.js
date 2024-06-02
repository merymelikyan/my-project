const fs = require('fs');
const uuid = require('uuid');
const path = require('path');

/**
 * PackageResolver class for resolving packages by fetching their contents from the cloud or using cached data.
 */
class PackageResolver {
  /**
   * Represents a PackageResolver constructor.
   * @constructor
   * @param {string} tempDirPath - The temporary directory path.
   * @param {string} collectionId - The collection ID.
   */
  constructor (tempDirPath, collectionId) {
    // Initialize script content cache
    this.scriptContentCache = {};

    this.tempDirPath = tempDirPath;
    this.collectionId = collectionId;

    // Bind resolvePackages method to the current instance
    this.resolvePackages = this.resolvePackages.bind(this);
  }

  /**
   * Resolves packages by fetching their contents from the cloud or using cached data.
   * @param {Object} options - The options for resolving packages.
   * @param {Object} options.packages - The packages to resolve.
   * @param {Function} callback - The callback function to invoke when the resolution is complete.
   */
  resolvePackages ({ packages }, callback) {
    // Check if there are no packages to resolve
    if (!packages || !Object.keys(packages).length) {
      return callback(null, {});
    }

    const id = uuid.v4();

    let packagesToFetch = {},
      cachedData = {},
      timeoutId;

    // Separate packages to fetch and cached packages
    Object.entries(packages).forEach(([packageName, packageData]) => {
      if (!this.scriptContentCache[packageName]) {
        packagesToFetch[packageName] = packageData;
      } else {
        cachedData[packageName] = { data: this.scriptContentCache[packageName] };
      }
    });

    // If all packages are cached, return cached data immediately
    if (Object.keys(packagesToFetch).length === 0) {
      return callback(null, cachedData);
    }

    // Subscribe to package events for fetching
    const unsubscribeRemotePackageEventListener = this._subscribeToPackageEvents(id, (error, fileData) => {
      if (error) {
        return callback(error, null);
      }

      Object.assign(fileData, cachedData);

      clearTimeout(timeoutId);

      callback(null, fileData);
    });

    // Publish package fetch event to start fetching
    this._publishPackageFetchEvent(packagesToFetch, id);

    // Cleanup event listener after a timeout
    timeoutId = this._cleanupEventListener(unsubscribeRemotePackageEventListener, callback);
  }

  /**
   * Subscribes to package events for fetching.
   * @param {Function} callback - The callback function to invoke when the resolution is complete.
   * @returns {Function} The function to unsubscribe from package events.
   * @private
   */
  _subscribeToPackageEvents (id, callback) {
    const unsubscribe = pm.eventBus.channel('package-ipc-event').subscribe((event) => {
      const { name, data } = event ?? {};

      if (name === 'package-fetch-failed' && data.id === id) {

        unsubscribe();
        callback(new Error('Cloud package fetch failed'));
      }

      if (name === 'package-fetch-completed' && data.id === id) {
        unsubscribe();
        const fileData = this._processFetchedData(data.packages);

        callback(null, fileData);
      }
    });

    return unsubscribe;
  }

  /**
   * Processes fetched data from package events.
   * @param {Object} data - The fetched data containing package names and file paths.
   * @returns {Object} An object containing package names as keys and file data as values.
   * @private
   */
  _processFetchedData (data) {
    const fileData = {};
    Object.entries(data).forEach(([packageName, filePath]) => {
      if (!filePath) {
        fileData[packageName] = { error: `Cannot find package ${packageName}` };
      }
      try {
        const tempFilePath = path.join(this.tempDirPath, filePath);
        const fileContents = fs.readFileSync(tempFilePath, 'utf8');
        fileData[packageName] = { data: fileContents };

        // Cache file contents
        this.scriptContentCache[packageName] = fileContents;
      } catch (error) {
        pm.logger.error('PackageResolver~_processFetchedData: Error reading file', error);
      }
    });

    return fileData;
  }

  /**
   * Publishes package fetch event to start fetching.
   * @param {Object} packagesToFetch - The packages to fetch.
   * @private
   */
  _publishPackageFetchEvent (packagesToFetch, id) {
    pm.eventBus.channel('package-ipc-event').publish({
      name: 'package-fetch-start',
      data: { packages: packagesToFetch, id, collectionId: this.collectionId }
    });
  }

  /**
   * Cleans up the event listener by unsubscribing and invoking the callback with an error after a timeout.
   * @param {Function} unsubscribe - The function to unsubscribe the event listener.
   * @param {Function} callback - The callback function to be invoked with an error.
   * @returns {void}
   */
  _cleanupEventListener (unsubscribe, callback) {
    const TIMEOUT = 60000; // Timeout for package fetch
    return setTimeout(() => {
      unsubscribe();
      callback(new Error('Cloud package fetch timed out'));
    }, TIMEOUT);
  }
}

module.exports = PackageResolver;
