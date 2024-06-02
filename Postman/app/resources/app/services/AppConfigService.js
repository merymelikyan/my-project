const sanitizeConfigValue = function (value) {
    if (typeof value === 'string') {
      return value.replace(/\'/g, '');
    }
    return value;
  };

class ConfigService {
  config = require('../config.json');

  overrideConfig = (overrides) => {
    this.config = {
      ...require('../config.json'),
      ...overrides
    };
  }

  getConfig = (key) => sanitizeConfigValue(this.config[key]);
}

const configService = new ConfigService();

module.exports = {
  configService,
  getConfig (key) {
    return configService.getConfig(key);
  }
};
