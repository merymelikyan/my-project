const COUNTRY = 'US',
  STATE = 'CA',
  LOCALITY = 'San Francisco',
  EMAIL = 'info@getpostman.com',
  ORG = 'Postman Inc.',
  ORGUNIT = 'Postman',
  DAYSTOEXPIRY = 500,
  COMMON_NAME = {
    dev: 'Postman Dev Proxy CA',
    test: 'Postman Test Proxy CA',
    beta: 'Postman Beta Proxy CA',
    stage: 'Postman Stage Proxy CA',
    canary: 'Postman Canary Proxy CA',
    prod: 'Postman Proxy CA'
  },
  KEYBITSIZE = 2048,
  HASH = 'sha256',
  CA_SUFFIX_NAME = 'postman-proxy-ca';

module.exports = {
  COUNTRY,
  STATE,
  LOCALITY,
  EMAIL,
  ORG,
  ORGUNIT,
  DAYSTOEXPIRY,
  COMMON_NAME,
  KEYBITSIZE,
  HASH,
  CA_SUFFIX_NAME
};
