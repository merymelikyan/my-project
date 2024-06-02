const _ = require('lodash');

/**
 * Function to split the text on the supplied separator
 *
 * @param {String} text
 * @param {String} [separator = '\n'] The line separator
 * @param {Boolean} [trim = true] Flag to determine if the line needs to be trimmed
 * @returns {Array.<String>} Array of Lines
 */
const splitOutput = (text, separator = '\n', trim = true) => {
  let lines = trim ? _.trim(text) : text;

  if (_.isEmpty(lines)) {
    return [];
  }

  lines = _.chain(lines)
    .split(separator)
    .map((line) => {
       line = trim ? _.trim(line) : line;
       return line;
    }).value();

  return lines;
};

/**
 * Function to return regex matches.
 *
 * @param {RegExp} regex The regular expression
 * @param {String} text The string to validate against
 * @returns {Array.<String>} Matched groups or null
 */
const regexValidator = (regex, line) => {
  if (!_.isRegExp(regex))
    return [];

  const matches = regex.exec(line);

  return matches ? _.slice(matches, 1) : [];
};

/**
 * Function to populate the array placeholders with its respective values
 *
 * @param {Array} arrayList The array for which we need to populate data. Eg : ['commit','-m',':message']
 * @param {Object} data The data to populate the array placeholders. Eg : { message : 'Commit message' }
 * @returns {Array} Array that is populated with the data. Eg: ['commit','-m','Commit message']
 */
const populateParams = (arrayList, data) => {
  const DELIMITER = ':';
  return _.reduce(arrayList, (populatedArray, item) => {
    const key = _.chain(item).split(DELIMITER).last().value();
    return _.concat(populatedArray, _.get(data, key, item));
  }, []);
};

module.exports = {
  splitOutput,
  regexValidator,
  populateParams
};
