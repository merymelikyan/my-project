const _ = require('lodash');

var shellUtils = {

  getUserIdfromData (userData) {
    return userData.id || userData.user_id || userData.userId;
  },

  isUserLoggedIn (id) {
    return !(_.isEmpty(id) || id === '0' || id === 0);
  }
};

module.exports = shellUtils;
