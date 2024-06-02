const _ = require('lodash'),
    https = require('https'),

    SUCCESS_CODE = 200;

/**
 * Helper function to make requests.
 * We are using a locally defined requests method using the standard https package
 * This is so that if events can be pushed even if app components for making requests have issues
 *
 * @param {Object} options - Options for request sending.
 * @param {String} [options.method=GET] - The request method.
 * @param {String} options.hostname - The request host.
 * @param {String} [options.path=/] - Request path.
 * @param {Object} [options.headers={}] - Request headers.
 * @param {Object} [options.body] - The request body.
 * @param {Function} cb - Invoked when the request sending attempt has completed.
 */
function request ({ method = 'GET', hostname, path = '/', headers = {}, body }, cb) {
  if (!hostname) {
      return cb(new Error('A valid hostname is required'));
  }

  const payload = typeof body === 'string' ? body : JSON.stringify(body);

  return https
      .request({ method, hostname, path, headers }, (res) => {
          let data = '';

          res.on('data', (chunk) => { data += chunk; });

          res.once('end', () => {
              let body;

              try { body = JSON.parse(data); }
              catch (err) { body = data; }

              cb(null, res, body);
          });
      })
      .once('error', cb)
      .end(payload);
}

    // Credentials for NewRelic account
let apiKey,
    accountId,

    // Stores metadata for frequent access
    metaData = {};

module.exports = {
    /**
     * Initialize NewRelic with the credentials needed to call the NeRelic API
     *
     * @param {String} apiKey - API Key for pushing data to NewRelic
     * @param {String} accountId - NewRelic account to which this will be pushed to
     */
    init (key, id) {
        apiKey = key;
        accountId = id;
    },

    /**
     * Attach extra metaData to the NewRelic objects.
     * This acts as a cache for future use and this metadata is passed to all calls to NewRelic
     *
     * @param {Object} data - Adds `data` to the existing metaData object.
     */
    setMetadata (data) {
      metaData = _.merge(metaData, data);
    },

    /**
     * Push the given event to newRelic
     *
     * @param {String} eventType - Event name used in NewRelic
     * @param {Object} body - Data to be passed to NewRelic
     */
     recordCustomEvent (eventType, body) {
        // Initialize a object that will contain the full payload of the API call
        let nrEvent = {
            eventType
        };

        // Merge the metadata and the event body into one JSON
        nrEvent = _.merge(nrEvent, metaData, body);

        if (nrEvent.stack && nrEvent.stack.length > 4096) {

            // Custom event values over 4096 chars are dropped by newrelic
            nrEvent.stack = nrEvent.stack.substring(0, 4096);
        }

        // Make the POST request to NewRelic
        request({
            method: 'POST',
            hostname: 'insights-collector.newrelic.com',
            path: `/v1/accounts/${accountId}/events`,
            headers: {
                'Api-Key': apiKey
            },
            body: nrEvent
        }, (err, res) => {
            if (err || res.statusCode !== SUCCESS_CODE) {
                // Not calling pm.logger.error() to prevent recursive invocation of this method
                pm.logger.warn(
                    'NewRelicService~RecordCustomEvent: API request failed',
                    err || new Error(`Received status code ${res.statusCode} from NewRelic`)
                );

                return;
            }
        });
    }
  };

