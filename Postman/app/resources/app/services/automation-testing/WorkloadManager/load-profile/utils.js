/**
 * Converts the given duration in milliseconds to minutes, rounded to four decimal places.
 */
function toMinutes (durationMs) {
  return parseFloat((durationMs / 60000).toFixed(4));
}

/**
 * Builds human readable durations for the given value in milliseconds
 *
 * @param {Object} value - The duration of time in milliseconds
 * @returns {String} - The human readable duration
 */
function humanizeDuration (value, expanded = false) {
  const valueMinutes = Math.floor(value / (60 * 1000));
  const seconds = Math.round((value % (60 * 1000)) / 1000);
  const segments = [];

  if (expanded) {
    if (valueMinutes > 0) {
      segments.push(`${valueMinutes} minute${valueMinutes === 1 ? '' : 's'}`);
    }

    if (segments.length === 0 || seconds > 0) {
      segments.push(`${seconds} second${seconds === 1 ? '' : 's'}`);
    }

    return segments.join(' ');
  }
  else {
    if (valueMinutes > 0) {
      segments.push(`${valueMinutes}`);
    }

    if (segments.length === 0 || seconds > 0) {
      segments.push(`${valueMinutes > 0 && seconds < 10 ? '0' : ''}${seconds}`);
    }

    if (valueMinutes > 0) {
      return `${segments.join(':')} minute${valueMinutes === 1 && seconds === 0 ? '' : 's'}`;
    }
    else {
      return `${segments.join(':')} second${seconds === 1 ? '' : 's'}`;
    }
  }
}

/**
 * Returns the value of margin, in milliseconds, to be used based on the total duration.
 *
 * @param {Number} duration - The total duration of the run, in milliseconds.
 *
 * @returns {Number} margin, in milliseconds.
 */
function marginByDuration (duration) {
  const oneSecond = 1000, // milliseconds
        oneMinute = 60 * oneSecond,
        tenSeconds = 10 * oneSecond,
        fiveSeconds = 5 * oneSecond;

  if (duration > 10 * oneMinute) {
    return oneMinute;
  }

  // If the duration is between 1 and 10 minutes, set the margin to 10 seconds.
  else if (duration > oneMinute && duration <= 10 * oneMinute) {
    return tenSeconds;
  }

  // If the duration is less than 1 minute, set the margin to 5 seconds.
  else {
    return fiveSeconds;
  }
}

module.exports = {
  toMinutes,
  humanizeDuration,
  marginByDuration
};
