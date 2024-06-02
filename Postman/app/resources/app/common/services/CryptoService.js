const keytar = require('keytar'),
  { app } = require('electron'),
  DEFAULT_NAMESPACE = app.getName(),
  USER_KEY_LABEL = 'userKey';

/**
 * Method to store the vault user key in the OS keychain
 * @param {string} userKey
 * @param {string} userId
 */
async function storeInKeychain (namespace = DEFAULT_NAMESPACE, userKey, userId) {
  try {
    const keytarServiceName = `${namespace} (${userId})`;
    await keytar.setPassword(keytarServiceName, USER_KEY_LABEL, userKey);
  } catch (error) {
    pm.logger.error('Error while storing user key in keychain', error);

    return Promise.reject(error);
  }
}

/**
 * Method to retrieve the vault user key from the OS keychain
 * @param {string} userId
 */
async function retrieveFromKeychain (namespace = DEFAULT_NAMESPACE, userId) {
  try {
    const keytarServiceName = `${namespace} (${userId})`;
    const userKey = await keytar.getPassword(keytarServiceName, USER_KEY_LABEL);

    return userKey;
  } catch (error) {
    pm.logger.error('Error while retrieving user key from keychain', error);

    return Promise.reject(error);
  }
}

module.exports = {
  storeInKeychain,
  retrieveFromKeychain,
};
