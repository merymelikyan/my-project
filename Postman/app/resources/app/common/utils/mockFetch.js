/* eslint-disable no-undef */
/**
 * A temporary fix to make 1Password sdk work with
 * node 16 - we inject node-fetch into global scope fetch
 *
 * @returns {() => void} disposer function which reverts the
 * injections done by this function
 */
const fetchMain = require('node-fetch').default;

const mockFetch = () => {
  let oldFetch, oldHeaders, oldRequest, oldResponse;

  if (!globalThis.fetch) {
    // Save older values to reset globalThis
    // back to these later
    oldFetch = globalThis.fetch;
    oldHeaders = globalThis.Headers;
    oldRequest = globalThis.Request;
    oldResponse = globalThis.Response;

    globalThis.fetch = fetchMain;
    globalThis.Headers = fetchMain.Headers;
    globalThis.Request = fetchMain.Request;
    globalThis.Response = fetchMain.Response;

    return () => {
      globalThis.fetch = oldFetch;
      globalThis.Headers = oldHeaders;
      globalThis.Request = oldRequest;
      globalThis.Response = oldResponse;
    };
  }

  return () => null;
};

module.exports = mockFetch;
