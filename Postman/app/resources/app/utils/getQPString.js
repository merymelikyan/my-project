/**
 * Get the string of query params from the given object where key is the key of the
 * QP and value is the value
 *
 * @returns {String}
 */
module.exports = function getQPString (params = {}) {
  let result = '';

  Object.entries(params).forEach(([key, value]) => {
    let paramString = `${key}${value ? '=' + value : ''}&`;
    result = result + paramString;
  });

  // Remove the trailing '&'
  return `?${result}`.slice(0, -1);
};
