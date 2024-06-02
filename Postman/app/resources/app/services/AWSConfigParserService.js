const path = require('path');
const os = require('os');
const sectionTypeRegex = /\[(.*)\]/;
const configLineRegex = /(.*)=(.*)/;

const parseCredentailsFile = (contents) => {
  const credentials = {};

  const lines = contents.split('\n').filter((line) => line !== '');

  let currentSectionName = null;
  lines.forEach((line) => {
    if (sectionTypeRegex.exec(line)) {
      currentSectionName = sectionTypeRegex.exec(line)[1];
      credentials[currentSectionName] = {};

      return;
    }

    const rawLine = line.replaceAll(' ', '');
    let parsedLine = configLineRegex.exec(rawLine);
    if (parsedLine.length != 3) {
      throw new Error('Unknown line format');
    }

    const key = parsedLine[1];
    const value = parsedLine[2];
    credentials[currentSectionName][key] = value;
  });
  return credentials;
};

const getAWSCredentialsPath = (filename) => {
  if (!filename) {
    filename = path.join('.aws', 'credentials');
  }
  const homeDir = os.homedir();
  const credentialsPath = path.join(homeDir, '.aws/credentials');

  return credentialsPath;
};

module.exports = {
  parseCredentailsFile,
  getAWSCredentialsPath
};
