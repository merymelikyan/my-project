const LoadProfile = require('./LoadProfile');

const { humanizeDuration } = require('./utils');

/**
 * This load profile represents a spike load over the entire duration:
*  ▲
 *  │                   x
 *  │                   /\
 *  │                  /  \3
 *  │                 /2   \
 *  │                /      \
 *  x───────1───────x        x───────4───────x
 *  │
 *  │
 *  └───────────────────────────────────────►
 *
 * 1. The base load, which can be adjusted to zero and be maintained for zero duration as well.
 * 2. The spike up load, increasing steadily from base to maximum load.
 * 3. The spike down load, decreasing steadily from maximum load to base load
 * 4. The final load, same as the base load for now, which is then maintained for the remainder of the duration.
 *
 * The x's represent the control points necessary to describe this load profile.
 */
class Spike extends LoadProfile {
  static get id () { return 'spike'; }
  static get name () { return 'Spike'; }
  static get defaultControlPoints () {
    return [
      {
        id: 'initial',
        time: {
          value: 0,
          name: 'Base load timestamp',
          anchor: 'initial'
        },
        load: {
          value: 0.1,
          name: 'Base load',
          description: 'The number of VUs to maintain before beginning the ramp to the maximum VU count, and after scaling back down.'
        }
      },
      {
        id: 'spikeStart',
        time: {
          value: 0.4,
          name: 'Spike start timestamp',
          margin: true
        },
        load: {
          value: 0.1,
          anchor: 'initial'
        }
      },
      {
        id: 'spikePeak',
        time: {
          value: 0.5,
          name: 'Spike peak timestamp',
          description: 'The time at which the spike has peaked at the maximum load.',
          margin: true
        },
        load: {
          value: 1,
          anchor: 'spikePeak'
        }
      },
      {
        id: 'spikeEnd',
        time: {
          value: 0.6,
          name: 'Spike end timestamp',
          description: 'Spike end timestamp.'
        },
        load: {
          value: 0.1,
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
          value: 0.1,
          anchor: 'initial'
        }
      },
    ];
  }

  get shorthand () { return 'Spike'; }
  get description () {
    const baseLoad = this.controlPoints.find((cp) => cp.id === 'initial').load.value;
    const initialDurationMs = this.controlPoints.find((cp) => cp.id === 'spikeStart').time.value;
    const spikePeakMs = this.controlPoints.find((cp) => cp.id === 'spikePeak').time.value;
    const spikeEndMs = this.controlPoints.find((cp) => cp.id === 'spikeEnd').time.value;
    const finalDurationMs = this.xMax - this.controlPoints.find((cp) => cp.id === 'spikeEnd').time.value;
    const spikeUpDurationMs = spikePeakMs - initialDurationMs;
    const spikeDownDurationMs = spikeEndMs - spikePeakMs;

    const maxLoad = this.yMax;
    const segments = [];

    // The base load is technically optional and only needs to be described if the duration is non-zero
    if (initialDurationMs > 0) {
      segments.push(`Simulate a fixed load of ${baseLoad} user${baseLoad === 1 ? '' : 's'} for ` +
        `${humanizeDuration(initialDurationMs)}. Then`);
    }

    segments.push(`${segments.length ? 's' : 'S'}pike up the load to ${maxLoad} ` +
      `user${maxLoad === 1 ? '' : 's'} over${segments.length ? ' the next ' : ' '}` +
      `${humanizeDuration(spikeUpDurationMs)}`);

    segments.push(`, and spike down the load from ${maxLoad} ` +
    `user${maxLoad === 1 ? '' : 's'} to  ${baseLoad} user${baseLoad === 1 ? '' : 's'} ` +
    `over${segments.length ? ' the next ' : ' '}` +
    `${humanizeDuration(spikeDownDurationMs)}`);

    if (finalDurationMs > 0) {
      segments.push(`and hold for ${humanizeDuration(finalDurationMs)}`);
    }

    return segments.join(' ') + '.';
  }
}

module.exports = Spike;
