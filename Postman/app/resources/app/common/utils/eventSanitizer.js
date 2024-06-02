// Sanitizes runtime events against given set of sensitive keywords
//
// The sanitization is controlled by the following event schemas. If schema
// for an event is unspecified, every field will be scanned.
//
//
// Event Schema Definition:
// The schemas are designed to be opt-out of sanitizations instead of opt-in
// So if unspecified everything will be sanitized
// The schema can be used to whitelist some fields like `header` keyword, so Postman UI elements are rendered properly
//
// Defines which keys to be checked and which should not be.
//  - `true` signifies should be recursively checked and sanitized.
//  - `false` signifies the field should not be sanitized
//  - function instance let's you provide a function that can transform the value.
//    - Function will get two params (sanitizer, value) and should return should have similar schema as `value` arg
//    - sanitizer is an function that takes a object and returns an object recursively sanitized for both key and values
//  - if any key is unspecified, it'll be sanitized recursively

const postmanEncoder = require('postman-url-encoder/encoder');
const TJ = require('teleport-javascript');

const _ = require('lodash');
const MIN_LENGTH = 3;

const mutationSchema = {
  id: false,
  name: false,
};

// the schema for the request object
const requestSchema = {
  url: {
    protocol: false,
  },
  method: false,
  body: {
    mode: false,
  },
};

// The schema for the response object
const requestResponseSchema = {
  cursor: false,

  // We don't obfuscate the vault variables if they are present in the response
  response: false,

  request: requestSchema,
  history: {
    execution: {
      verbose: false,
      sessions: false,

      data: [{
        response: false,
        request: requestSchema,
        session: false
      }]
    }
  }


};

// Event schema for different types of events
const eventSchemas = {
  item: {
    visualizerData: false
  },
  script: {
    cursor: false,
    mutations: {
      _variables: mutationSchema,
      environment: mutationSchema,
      globals: mutationSchema,
      collectionVariables: mutationSchema,
    },
    event: false,
  },
  console: {
    cursor: false,
    level: false,
    messages: [(sanitizer, value) => {
      try {
        let parsedValue = TJ.parse(value);
        let sanitizedValue = sanitizer(parsedValue);
        return TJ.stringify(sanitizedValue);
      }
      catch (e) {
        pm.logger.error('EventSanitizer~console.messages Error while parsing value', e);

        return value;
      }
    }]

  },
  assertion: {
    cursor: false,
    assertions: [{
      error: {
        operator: false,
      }
    }]
  },
  responseStart: requestResponseSchema,
  response: requestResponseSchema,
  request: requestResponseSchema
};

const PLACEHOLDER = '*****';


class EventSanitizer {
  /**
   *
   * @param {string[]} words
   */
  constructor (words) {
    this.words = words;
    let sensitiveWordSet = new Set();

    // Create a set of sensitive words and build a regex pattern
    for (const word of words) {
      EventSanitizer._getPossibleWordVariations(word).forEach((value) => {
        if (value.length >= MIN_LENGTH) {
          sensitiveWordSet.add(value);
        }
      });
    }

    if (sensitiveWordSet.size == 0) {
      this.sanitizerRegex = null;
    } else {
      let regexPattern = [...sensitiveWordSet].map(EventSanitizer._escapeRegex).join('|');
      this.sanitizerRegex = new RegExp(regexPattern, 'ig');
    }
    this.knowns = new WeakSet();
  }

  /**
   * @private
   * Returns if the sanitizer should scan for sensitive words
   * @returns {boolean}
   */
  _shouldScan () {
    return this.sanitizerRegex != null;
  }

  /**
   *
   * Sanitizes events emitted by postman-runtime i.e. redact vault variables (could be extended to secret type variables if required)
   * This function is the entry point into this class
   * @param {String[]} sensitiveWords
   * @param {string} event
   * @param {any} data
   * @returns {any} - sanitized data
   */
  sanitizeRuntimeEvent (event, data) {
    if (!this._shouldScan()) {
      return data;
    }
    return this._sanitizeAgainstSchema(eventSchemas[event], data);
  }

  /**
   * @private
   * Sanitizes a string against a given set of sensitive words
   * @param {string} data
   * @returns {string}
   */
  _sanitizeString (data) {
    if (!this._shouldScan()) {
      return data;
    }
    return data.replace(this.sanitizerRegex, PLACEHOLDER);
  }

  /**
   * @private
   * Recursively sanitize different data types
   * @param {*} data
   * @param {boolean} sanitizeKeys
   * @returns
   */
  _sanitizeAny (data, sanitizeKeys = false) {
    if (this.knowns.has(data)) {
      return data;
    }
    if (typeof data == 'string') {
      return this._sanitizeString(data);
    }
    else if (Array.isArray(data)) {
      this.knowns.add(data);
      for (const [index, value] of data.entries()) {
        data[index] = this._sanitizeAny(value, sanitizeKeys);
      }
      return data;
    }
    else if (_.isPlainObject(data)) {
      this.knowns.add(data);
      for (let [key, value] of Object.entries(data)) {
        if (sanitizeKeys) {
          delete data[key];
          key = this._sanitizeString(key);
        }
        data[key] = this._sanitizeAny(value, sanitizeKeys);
      }
      return data;
    }

    // If any other data type, ignore it
    // TODO: can be improved to extensively cover all additional types
    return data;
  }

  /**
   * @private
   * Sanitizes data against a given schema
   * @param {*} schema
   * @param {*} data
   * @returns
   */
  _sanitizeAgainstSchema (schema, data) {
    if (schema == false) {
      return data;
    }
    else if (schema == true || schema == undefined || schema == null) {
      return this._sanitizeAny(data);
    }
    else if (typeof schema === 'function') {
      return schema((x) => this._sanitizeAny(x, true), data);
    }
    else if (Array.isArray(data)) {
      if (!Array.isArray(schema) || schema.length != 1) {
        return this._sanitizeAny(data);
      } else {
        let childSchema = schema[0];
        for (const [index, val] of data.entries()) {
          data[index] = this._sanitizeAgainstSchema(childSchema, val);
        }
        return data;
      }
    }
    else if (_.isPlainObject(data)) {
      if (!_.isPlainObject(schema)) {
        return this._sanitizeAny(data);
      } else {
        for (const [key, val] of Object.entries(data)) {
          if (typeof schema[key] != 'undefined') {
            data[key] = this._sanitizeAgainstSchema(schema[key], val);
          } else {
            data[key] = this._sanitizeAny(val);
          }
        }
        return data;
      }
    } else {
      return this._sanitizeAny(data);
    }
  }

  /**
   * @private
   * Escapes regex specific characters
   * @param {String} string
   * @returns {String}
   */
  static _escapeRegex (word) {
    return word.replace(/[/\-\\^$*+?.()|[\]{}]/g, '\\$&');
  }

  /**
   * @private
   * Generates base64 representations of a given value
   * @param {String} value
   * @returns {[String, String, String]}
   */
  static _getBase64Representations (value) {
    // Algorithm:
    // Base64 Property: Every 3 bytes are converted to 4 base64 characters
    //
    // So once all the 3 bytes are rotated in position, the base64 will again be same
    // For example: if the word we want to search for is 'foobar'
    // We can only have three variations of it's base64 encoding
    // foobar - no prefix
    // .foobar - prefix of length 1
    // ..foobar - prefix of length 2
    // ...foobar - (This base64 representation will repeat the no-prefix encoding)
    let rv = [];
    for (const i of [0, 1, 2]) {
      let word_len_to_use = Math.floor((value.length - i) / 3) * 3;
      let word_part = value.slice(i, i + word_len_to_use);
      let word_part_b64 = Buffer.from(word_part).toString('base64');
      rv.push(word_part_b64);
    }
    return rv;
  }

  /**
   * @private
   * Generate possible word variations for a given word
   * @param {String} word
   * @returns {String[]}
  */
  static _getPossibleWordVariations (word) {
    return [
      word,
      encodeURIComponent(word),
      postmanEncoder.encodeQueryParam(word),
      ...EventSanitizer._getBase64Representations(word)
    ];
  }
}

module.exports = {
  EventSanitizer,

  // Used in tests
  PLACEHOLDER,
};
