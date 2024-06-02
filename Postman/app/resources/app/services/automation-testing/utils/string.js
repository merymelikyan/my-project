/**
 * Returns a function that can be used to replace circular references in an object while stringifying it.
 *
 * @returns {function(*, *): *}
 */
const getReplacer = () => {
  // WeakSet is used to allow garbage collection of objects that are no longer referenced
  const seen = new WeakSet();

  return (key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return;
      }
      seen.add(value);
    }
    return value;
  };
};

/**
 * Deserializes an object that was serialized with `serializeObject` function (a special function that preserves
 * undefined values in objects and arrays by replacing them with a `placeholder` string). The placeholder string
 * is passed as the second argument to this function and should be the same as the one used in `serializeObject`.
 *`
 * @param {object} value - Object to deserialize
 * @param [undefinedPlaceholder='___undefined___'] - Placeholder string that was used to replace `undefined` values
 * in the serialized object
 *
 * @returns {undefined|any} - Returns `undefined` if the value is `undefined` or the deserialized object
 */
function deserializeObject (value, undefinedPlaceholder = '___undefined___') {
  let obj;

  try {
    obj = JSON.parse(value);
  }
  catch (error) {
    pm.logger.error('ExecutionProcess~Failed to parse the given string into json');

    // TODO: Handle this error while calling runRunners
    throw error;
  }

  if (obj === undefinedPlaceholder) {
    return undefined;
  }

  /**
   * Function that walks through nested values and calls the callback for each value that is not an object or array.
   * The callback can modify the value, its parent and the key of the value in the parent. The changes will be
   * reflected in the original object. The callback can also return a value that will be used as the new value
   * of the current value.
   *
   * @param {any} value - Value to iterate
   * @param {function} callback - Callback function
   * @param {any} parent - Parent of the value
   * @param {string} key - Key of the value in the parent
   */
  function deepIterate (value, callback, parent, key) {
    if (typeof value === 'object' && value !== null) {
      Object.entries(value).forEach(([entryKey, entryValue]) =>
        deepIterate(entryValue, callback, value, entryKey)
      );
    } else if (Array.isArray(value)) {
      value.forEach((itemValue, itemIndex) =>
        deepIterate(itemValue, callback, value, itemIndex)
      );
    } else if (parent !== undefined) {
      callback(value, parent, key);
    }
  }

  /**
   * It will replace the placeholder string with `undefined` if the value is the placeholder string.
   */
  deepIterate(obj, (value, parent, key) => {
    if (value === undefinedPlaceholder) {
      parent[key] = undefined;
    }
  });

  return obj;
}

module.exports = {
  getReplacer,
  deserializeObject
};
