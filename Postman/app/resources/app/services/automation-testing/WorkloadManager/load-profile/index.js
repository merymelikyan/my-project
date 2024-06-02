/**
 * A load profile completely encapsulates everything necessary to formally and qualitatively describe a changing
 * quantity over time. Refer to the LoadProfile base class for more information.
 *
 * Additional load profiles can be added by extending the LoadProfile base class and adding it to the list of exports
 * in this file.
 */

[
  require('./constant'),
  require('./ramp'),
  require('./spike'),
  require('./peak'),
].forEach((profile) => module.exports[profile.id] = profile);
