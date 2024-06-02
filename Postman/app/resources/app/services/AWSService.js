const request = require('postman-request');
const { XMLParser } = require('fast-xml-parser');
const aws4 = require('aws4');

const generatePath = (requestParams) => '/?' + Object.entries(requestParams)
        .map(([val, key]) => `${val}=${key}`).join('&');

// @ts-check
class STS {
  static STS_URL = 'https://sts.amazonaws.com';
  constructor (config) {
    this.apiVersion = config.apiVersion;
    this.accessKeyId = config.accessKeyId;
    this.secretAccessKey = config.secretAccessKey;
    this.sessionToken = config.sessionToken;
  }

  getSessionToken (params, callback) {
    const requestParams = {
      Version: this.apiVersion,
      Action: 'GetSessionToken',
      DurationSeconds: params.DurationSeconds,
      ...(params.SerialNumber && { SerialNumber: params.SerialNumber }),
      ...(params.TokenCode && { TokenCode: params.TokenCode }),
    },
      path = generatePath(requestParams),
      credentials = {
        accessKeyId: this.accessKeyId,
        secretAccessKey: this.secretAccessKey
      },
      signatureParams = {
        service: 'sts',
        path: path,
      },
      signedData = aws4.sign(signatureParams, credentials);

    const options = {
      method: 'GET',
      url: `${STS.STS_URL}${path}`,
      ...signedData
    };

    request(options, function (err, response) {
      if (err) {
        return callback(err);
      }

      try {
        const parser = new XMLParser();
        const json = parser.parse(response.body);
        if (json['ErrorResponse']) {
          return callback('Failed to get temporary credentials');
        }
        return callback(null, json?.['GetSessionTokenResponse']?.['GetSessionTokenResult']);
      } catch (error) {
        return callback(error);
      }
    });
  }

  assumeRole (params, callback) {
    const requestParams = {
      Version: this.apiVersion,
      Action: 'AssumeRole',
      DurationSeconds: params.DurationSeconds,
      RoleArn: params.RoleArn,
      RoleSessionName: params.RoleSessionName,
      ...(params.SerialNumber && { SerialNumber: params.SerialNumber }),
      ...(params.TokenCode && { TokenCode: params.TokenCode }),
    },
      path = generatePath(requestParams),
      credentials = {
        accessKeyId: this.accessKeyId,
        secretAccessKey: this.secretAccessKey,
        ...(this.sessionToken && { sessionToken: this.sessionToken })
      },
      signatureParams = {
        service: 'sts',
        path: path,
      },
      signedData = aws4.sign(signatureParams, credentials);

    const options = {
      method: 'GET',
      url: `${STS.STS_URL}${path}`,
      ...signedData
    };

    request(options, function (err, response) {
      if (err) {
        return callback(err);
      }

      try {
        const parser = new XMLParser();
        const json = parser.parse(response.body);
        if (json['ErrorResponse']) {
          return callback('Failed to assume role');
        }
        return callback(null, json?.['AssumeRoleResponse']?.['AssumeRoleResult']);
      } catch (error) {
        return callback(error);
      }
    });
  }

  getCallerIdentity (params, callback) {
    const body = {
      Version: this.apiVersion,
      Action: 'GetCallerIdentity',
    },
      credentials = {
        accessKeyId: this.accessKeyId,
        secretAccessKey: this.secretAccessKey,
        ...(this.sessionToken && { sessionToken: this.sessionToken })
      },
      signatureParams = {
        service: 'sts',
        body: `Action=GetCallerIdentity&Version=${this.apiVersion}`
      },
      signedData = aws4.sign(signatureParams, credentials);

    const options = {
      url: `${STS.STS_URL}/`,
      ...signedData,
    };

    request(options, function (err, response) {
      if (err) {
        return callback(err);
      }

      if (response.statusCode != 200) {
        return callback('Failed to verify credentials');
      }

      try {
        const parser = new XMLParser();
        const json = parser.parse(response.body);
        if (json['ErrorResponse']) {
          return callback('Failed to verify credentials');
        }
        return callback(null, true);
      } catch (error) {
        return callback(error);
      }
    });
  }
}

class SecretsManager {
  constructor (config) {
    this.apiVersion = config.apiVersion;
    this.accessKeyId = config.accessKeyId;
    this.secretAccessKey = config.secretAccessKey;
    this.region = config.region;
    this.sessionToken = config.sessionToken;
  }

  getSecretsManagerEndpoint () {
    return `https://secretsmanager.${this.region}.amazonaws.com`;
  }

  getSecretValue (secretData, callback) {
    const credentials = {
        accessKeyId: this.accessKeyId,
        secretAccessKey: this.secretAccessKey,
        sessionToken: this.sessionToken,
      },
      body = JSON.stringify({
        SecretId: secretData.SecretId,
        VersionId: secretData.VersionId,
      }),
      signatureParams = {
        method: 'POST',
        service: 'secretsmanager',
        region: this.region,
        headers: {
          'Content-Type': 'application/x-amz-json-1.1',
          'X-Amz-Target': 'secretsmanager.GetSecretValue'
        },
        body: body
      },
      signedData = aws4.sign(signatureParams, credentials);

    const options = {
      method: 'POST',
      url: this.getSecretsManagerEndpoint(),
      ...signedData,
    };

    request(options, function (err, response) {
      if (err) {
        return callback(err);
      }

      try {
        const json = JSON.parse(response.body);

        if (response.statusCode != 200) {
          return callback('Failed to fetch Secret Value');
        }
        return callback(null, json);
      } catch (error) {
        return callback(error);
      }
    });
  }
}

class IAM {
  static IAM_URL = 'https://iam.amazonaws.com';
  constructor (config) {
    this.apiVersion = config.apiVersion;
    this.accessKeyId = config.accessKeyId;
    this.secretAccessKey = config.secretAccessKey;
  }

  listMFADevices (params, callback) {
    const requestParams = {
      Version: this.apiVersion,
      Action: 'ListMFADevices',
    },
      path = generatePath(requestParams),
      credentials = {
        accessKeyId: this.accessKeyId,
        secretAccessKey: this.secretAccessKey
      },
      signatureParams = {
        service: 'iam',
        path: path,
      },
      signedData = aws4.sign(signatureParams, credentials);

    const options = {
      method: 'GET',
      url: `${IAM.IAM_URL}${path}`,
      ...signedData
    };

    request(options, function (err, response) {
      if (err) {
        return callback(err);
      }

      try {
        const parser = new XMLParser();
        const json = parser.parse(response.body);
        if (json['ErrorResponse']) {
          return callback('Failed to get MFA Details');
        }
        const mfaData = json?.['ListMFADevicesResponse']?.['ListMFADevicesResult'];

        // Due to the way XML is parsed, member is resolved as an object if it contains
        // only one entry. We change it to an array.
        if (mfaData?.MFADevices?.member && !Array.isArray(mfaData.MFADevices.member)) {
          mfaData.MFADevices.member = [mfaData.MFADevices.member];
        }

        if (mfaData?.MFADevices?.member) {
          mfaData.MFADevices = mfaData.MFADevices.member;
        } else {
          mfaData.MFADevices = [];
        }

        return callback(null, mfaData);
      } catch (error) {
        return callback(error);
      }
    });
  }
}

module.exports = {
  STS,
  SecretsManager,
  IAM
};
