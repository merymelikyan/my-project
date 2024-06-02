const LoadProfile = require('./LoadProfile');

const { toMinutes } = require('./utils');

/**
 * This load profile represents a constant load over the entire duration:
 *
 *  ▲
 *  │
 *  │
 *  x─────────────────x maxLoad
 *  │
 *  └──────────────────►
 *
 * The x's represent the control points necessary to describe this load profile.
 */
class Constant extends LoadProfile {
  static get id () { return 'fixed'; }
  static get name () { return 'Fixed'; }
  static get defaultControlPoints () {
    return [
      {
        id: 'initial',
        time: {
          value: 0,
          anchor: 'initial'
        },
        load: {
          value: 1,
          anchor: 'initial'
        }
      },
      {
        id: 'final',
        time: {
          value: 1,
          anchor: 'final'
        },
        load: {
          value: 1,
          anchor: 'initial'
        }
      }
    ];
  }

  // Originally named Constant, but renamed to Fixed later on because it was easier for users to understand
  get shorthand () { return 'Fixed'; }
  get description () {
    const vuCount = this.yMax;
    const totalDurationMins = toMinutes(this.xMax);
    const pluralizedUsers = `user${this.yMax === 1 ? '' : 's'}`;
    const pluralizedMinutes = `minute${this.xMax === 1 ? '' : 's'}`;
    const parallelismClause = `${vuCount === 1 ? '' : ', in parallel,'}`;

    return `Simulate ${vuCount} virtual ${pluralizedUsers} repeatedly running the collection` +
      `${parallelismClause} for ${totalDurationMins} ${pluralizedMinutes}.`;
  }
}

module.exports = Constant;
