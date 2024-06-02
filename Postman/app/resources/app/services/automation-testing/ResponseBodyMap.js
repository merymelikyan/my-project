'use string';
const SHA1 = require('crypto-js/sha1');
const hexEncoder = require('crypto-js/enc-hex');
const RESPONSE_LIMIT_PER_ERROR = 10;
const TOTAL_RESPONSE_LIMIT = 100;

module.exports = class ResponseBodyMap {
   responseMap = {};
   responseMapBySegregation = {};

   static ERROR_TYPES = {
     TOTAL_LIMIT_EXCEEDED: {
       code: 'TOTAL_LIMIT_EXCEEDED',
       message: 'Limit for unique responses exceeded'
     },
     RESPONSE_LIMIT_PER_ERROR_EXCEEDED: {
       code: 'RESPONSE_LIMIT_PER_ERROR_EXCEEDED',
       message: 'Limit for unique responses for request and error combination exceeded'
     },
     HASH_COLLISION_DETECTED: {
       code: 'HASH_COLLISION_DETECTED',
       message: 'Hash collision occurred for different response bodies'
     }
   };

   addResponse ({
       request,
       errorMetricName,
       response,
       item,
       virtualUser
     }) {
    if (!this.responseMapBySegregation[request.id]) {
      this.responseMapBySegregation[request.id] = {};
    }
    if (!this.responseMapBySegregation[request.id][errorMetricName]) {
      this.responseMapBySegregation[request.id][errorMetricName] = {};
    }

    const hash = response.hash || hexEncoder.stringify(SHA1(response.body));
    let errorType;

    if (!this.responseMap[hash]) {
      // Detect if the total map has already touched its limit
      if (Object.keys(this.responseMap).length >= TOTAL_RESPONSE_LIMIT) {
        errorType = ResponseBodyMap.ERROR_TYPES.TOTAL_LIMIT_EXCEEDED;
      }
    } else if (this.responseMap[hash] !== response.body) {
      // Since the hash key already exists, detect if the value is same
      errorType = ResponseBodyMap.ERROR_TYPES.HASH_COLLISION_DETECTED;
    }

    const responsesForError = this.responseMapBySegregation[request.id][errorMetricName];
    if (!responsesForError[hash]) {
      // Detect if the request+error combination map has already touched its limit
      if (Object.keys(responsesForError).length >= RESPONSE_LIMIT_PER_ERROR) {
        errorType = ResponseBodyMap.ERROR_TYPES.RESPONSE_LIMIT_PER_ERROR_EXCEEDED;
      }
    }

    if (errorType) {
      let error = new Error(errorType.message);
      error.code = errorType.code;

      throw error;
    }

    this.responseMap[hash] = response.body;

    if (!this.responseMapBySegregation[request.id][errorMetricName][hash]) {
      this.responseMapBySegregation[request.id][errorMetricName][hash] = { request, response, item, virtualUser };
    }

    return hash;
  }

  getResponseMap () {
    return {
      responseMap: this.responseMap,
      responseMapBySegregation: this.responseMapBySegregation
    };
  }
};
