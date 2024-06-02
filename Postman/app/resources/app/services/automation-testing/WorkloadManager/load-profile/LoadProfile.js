// This is an exceptional case where we only want to import the part of the module that's absolutely necessary
// because this needs to be imported outside of `main` to support rendering the load profiles in the GUI. This can be
// removed if:
//   - node version is bumped to v17+, at which point `structuredClone` can be used and this import can be removed.
//   - The 3500 KB size limit on the vendor chunk is increased to give a 20 KB buffer.
// eslint-disable-next-line lodash/import-scope
const cloneDeep = require('lodash/cloneDeep');
const { marginByDuration } = require('./utils');

const MIN_TO_MS = 60 * 1000;

/**
 * Abstract class for load profiles. Load profiles are used to describe the expected load over the duration of a
 * performance test. Load profiles are used by the Workload Manager to generate the load curve.
 *
 * Each load profile should implement the following:
 *  - An `id` to uniquely identify the profile.
 *  - A `name` to uniquely identify the profile for human presentation.
 *  - A `shorthand` getter which returns a string representation of the load profile.
 *  - A `controlPoints` property which is an array of control points.
 *  - A `validator` method which validates the control points of the load profile.
 *  - An `evaluate` method which evaluates the load profile at a given time.
 *
 * A load profile can only be composed of straight lines, so we can completely characterize the curve using just the
 * vertices. Each vertex is a "control point" and its position in a unit square is described by "time" on the x-axis
 * and "load" on the y-axis. Each control point can have additional attributes as well to fully encapsulate all
 * information necessary to represent the control point(s) accurately. A ControlPoint has the following schema:
 *
 * {
 *   id: String; Unique within this group of control points
 *   time: {
 *     value: Number; Between 0 and 1, inclusive.
 *     anchor: String; A reference to this or another ControlPoint "id", indicating that this time is not
 *       independently controllable but is bound to the value of another control point, if the anchor is the "id" of
 *       another control point, or to the initial value of this control point, if the anchor is the "id" of this
 *       control point.
 *     name: [String]; A user-friendly reference to this control point.
 *     description: [String]; A user-friendly description of what this control point represents, in the context of the
 *       load profile.
 *     margin: [Boolean]; Whether or not this control point should maintain a margin from the following control point,
 *       along the time dimension.
 *   }
 *   load: {
 *     value: Number; Between 0 and 1, inclusive.
 *     anchor: String; Refer description of anchor above.
 *     name: [String]; A user-friendly reference to this control point.
 *     description: [String]: A user-friendly description of what this control point represents, in the context of the
 *       load profile.
 *   }
 * }
 *
 * @abstract
 * @class LoadProfile
 */
class LoadProfile {
  constructor (xMax, yMax) {
    this.xMax = xMax;
    this.yMax = yMax;

    // The default control points are immutable, so create a deep clone within this instance instead of a reference.
    this.controlPointsTemplate = cloneDeep(this.constructor.defaultControlPoints);
  }

  /**
   * Evaluates the load profile at a given time.
   *
   * @param {Object} options - The options to evaluate the load profile.
   * @param {Object} options.loadProfile - The load profile POJO containing all the data about the load profile.
   * @param {Number} options.elapsedMs - The elapsed time in milliseconds.
   *
   * @returns {Number} - The load at the given time.
   */
  static evaluate = ({ loadProfile, elapsedMs }) => {
    if (typeof elapsedMs !== 'number') {
      throw new TypeError('elapsedMs should be a number');
    }

    if (elapsedMs < 0) {
      throw new RangeError('elapsedMs should be greater than or equal to 0');
    }

    // TODO: Maybe change the below two checks be made while setting those values
    if (this.xMax <= 0) {
      throw new RangeError('Duration should be greater than 0');
    }

    if (this.yMax <= 0) {
      throw new RangeError('Max load should be greater than 0');
    }

    if (elapsedMs > loadProfile.xMax) {
      throw new RangeError('elapsedMs should be less than or equal to run duration');
    }

    const [sourcePoint, targetPoint] = findPoints(loadProfile.controlPoints, elapsedMs);

    const slope = ((targetPoint.load.value - sourcePoint.load.value) /
      ((targetPoint.time.value - sourcePoint.time.value)));
    const timeSinceLastPoint = elapsedMs - (sourcePoint.time.value);

    return Math.round(sourcePoint.load.value + (slope * timeSinceLastPoint)) || 0;
  }

  /**
   * A globally unique identifier for this load profile.
   *
   * @return {string}
   */
  get id () {
    return this.constructor.id;
  }

  /**
   * A user-friendly, globally unique name for this load profile.
   *
   * @return {string}
   */
  get name () {
    return this.constructor.name;
  }

  /**
   * The control points describing a load profile cannot be directly manipulated. This method returns a cloned
   * equivalent of this LoadProfile's internal representation of its control points.
   *
   * @type {ControlPoint[]} A set of control points describing this load profile, in chronological order.
   */
  get controlPoints () {
    const clonedControlPoints = cloneDeep(this.controlPointsTemplate);

    return clonedControlPoints.map((cp) => {
      cp.time.value = Math.round(this.xMax * cp.time.value);
      cp.load.value = Math.round(this.yMax * cp.load.value);

      return cp;
    });
  }

  /**
   * Given the "id" of a single control point in this load profile, modify the corresponding "load" value.
   *
   * @param {string} options.id - The "id" of the control point for which the "value" is to be set.
   * @param {number} options.value - The value to be set, in scaled terms. This will be scaled down to a unit square
   *                                 internally.
   */
  setLoadValue ({ id, value }) {
    // First sanitize the input by:
    //  - Clamping it within the valid range for load values -- between 0 and the maximum load, yMax
    //  - Binning it to the nearest integer.
    const clampedValue = clampInt(0, value, this.yMax);
    const binnedValue = Math.round(clampedValue);
    const unitValue = binnedValue / this.yMax;

    // A single load value can apply to more than one control point -- the primary one being modified and also others
    // with loads anchored to the primary control point's load. Find all relevant control points to be modified before
    // applying changes.
    const thisControlPoint = this.controlPointsTemplate.find((cp) => cp.id === id);
    const anchoredSiblings = this.controlPointsTemplate.filter((cp) => cp.load.anchor === id);

    // If a control point is anchored to its own load value, it cannot be modified. This should never happen in
    // practice since inputs shouldn't be accepted in the first place, but better safe than sorry.
    if (typeof thisControlPoint.load.anchor !== 'undefined') {
      return;
    }

    for (const controlPoint of [thisControlPoint, ...anchoredSiblings]) {
      controlPoint.load.value = unitValue;
    }
  }

  /**
   * Given the "id" of a single control point in this load profile, modify the corresponding "time" value. This method
   * does so after sanitizing the input: clamping to between the previous and next point, binning to whole integers.
   *
   * Control points are clamped to the previous & next point in the time dimension, unlike along the load dimension.
   *
   * @param {string} options.id - The "id" of the control point for which the "value" is to be set.
   * @param {number} options.value - The value to be set, in scaled terms. This will be scaled down to a unit square
   *                                 internally.
   */
  setTimeValue ({ id, value }) {
    // First sanitize the input by:
    //  - Clamping it within the valid range for load values -- between the times of previous and next control points.
    //    This is different from loads because of adjacency -- controls points must maintain chronological order
    //    within the array.
    //  - Binning it to the nearest integer.
    const thisIndex = this.controlPointsTemplate.findIndex((cp) => cp.id === id);
    const thisPoint = this.controlPointsTemplate[thisIndex];
    const margin = marginByDuration(this.xMax);

    const xMin = (() => {
      const previousPoint = this.controlPointsTemplate[thisIndex - 1];
      const defaultBound = previousPoint?.time.value || 0;
      const marginCountFromThisPoint = thisIndex > 0 ? this.controlPointsTemplate.slice(thisIndex - 1)
        .filter((cp) => cp.time?.margin).length : 0;

      let scaledBound = defaultBound * this.xMax;

      // Adjust the minimum bound if the previous control point expects a margin to be maintained. The default margin
      // to be maintained is one scaled unit, until otherwise necessary. This control point can't exceed xMax even with
      // the margin included, so the minimum bound doesn't need to be adjusted if it's already within 1 unit of xMax.
      if (previousPoint?.time.margin === true) {
        // We do not have the room to fit all the points with margins beyond this point, so move the previous point
        // using a recursive call to adjust the time of the points before that. Since it is recursive, this call will
        // take care of moving any other points before it, to make the necessary room.
        if (scaledBound > (this.xMax - (margin * marginCountFromThisPoint))) {
          this.setTimeValue({ id: previousPoint.id, value: this.xMax - (margin * marginCountFromThisPoint) });

          scaledBound = this.xMax - (margin * marginCountFromThisPoint);
        }

        scaledBound += margin;
      }

      return scaledBound;
    })();

    let xMax = (() => {
      const nextPoint = this.controlPointsTemplate[thisIndex + 1];
      const defaultBound = nextPoint?.time.value || 1;
      let scaledBound = defaultBound * this.xMax;

      // Adjust the maximum bound if this control point expects a margin to be maintained. The default margin
      // to be maintained is one scaled unit, until otherwise necessary. This control point cannot be less than 0 even
      // with margin constraints, so the maximum bound doesn't need to be adjusted if it's already within 1 unit of 0.
      if (thisPoint?.time.margin === true) {
        if (scaledBound >= margin) {
          scaledBound -= margin;
        }

        // TODO: If there is no room, should the next point be moved.
        // What if it has it's own margin and needs to move the point after that.
        // This is starting to look like a recursive problem.
      }

      return scaledBound;
    })();

    // When we update the time of the points in order, based on a change in duration, we will have
    // xMin based on the new duration and the xMax based on the old duration. And sometimes this can
    // lead to xMin being greater than xMax. In such cases, we make them both equal to the bigger of those.
    // TODO: This avoid the over lap of points that should not overlap, one which having a margin.
    //       But this is not an ideal solution, we'll have to find a better way to handle this.
    if (xMin > xMax) {
      xMax = xMin;
    }

    const clampedValue = clampInt(xMin, value, xMax);
    const binnedValue = binValueByDuration({ value: clampedValue, totalDuration: this.xMax });
    const unitValue = binnedValue / this.xMax;

    thisPoint.time.value = unitValue;
  }

  /**
   * Set the internal "xMax" value used to scale the time dimension of the load profile. The internal representation
   * uses a unit square where the "time" will be between 0 and 1, inclusive. The xMax value is then used to scale this
   * unit square up to match the desired duration of the load profile.
   *
   * @param {number} options.xMax - A non-zero integer value, representing the actual total duration of the load profile
   *                                in minutes.
   */
  setXMax ({ xMax }) {
    this.xMax = xMax;
  }

  /**
   * Set the internal "yMax" value used to scale the load dimension of the load profile. The internal representation
   * uses a unit square where the "load" will be between 0 and 1, inclusive. The yMax value is then used to scale this
   * unit square up to match the desired maximum load of the load profile.
   *
   * @param {number} options.yMax - A non-zero integer value, representing the actual maximum load this load profile
   *                                should scale to.
   */
  setYMax ({ yMax }) {
    this.yMax = yMax;
  }

  /**
   * The method to setup the control points of a load profile. This method is not supposed to
   * change the values of the control points' time and load explicitly, but it should do so only
   * using the setTimeValue and setLoadValue methods. The need for this method is that each of the
   * load-profiles can have their own ways of checking and loading points in different orders.
   *
   * @param {Object} params
   * @param {Object} params.controlPoints - The control points to be set in the instance.
   */
  setControlPoints ({ controlPoints }) {
    const currentControlPoints = this.controlPoints;

    /**
     * Function to set a control point by recursing through the blocking control points and
     * setting them first.
     *
     * Blocking control points are points that conflict when we try to set the value of another point.
     *
     * @param {*} controlPoint - The control point to be set
     * @param {*} allControlPoints - All of the control points to be set, needed to make the recursive call
     * @param {*} currentControlPoints - The current set of control points to compare to, to check for blocks
     */
    const setControlPointRecursive = (controlPoint, allControlPoints, currentControlPoints) => {
      const blockers = findBlockers(controlPoint, currentControlPoints);

      if (blockers.length === 0) {
        setControlPoint(controlPoint);

        // we can set only the load of a particular point, we won't have time in those cases
        if (controlPoint.time) {
          currentControlPoints.find((cp) => cp.id === controlPoint.id).time.value = controlPoint.time.value;
        }
      }
      else {
        blockers.forEach((blocker) => {
          const correspondingControlPoint = allControlPoints.find((controlPoint) => controlPoint.id === blocker.id);

          if (correspondingControlPoint) {
            setControlPointRecursive(correspondingControlPoint, allControlPoints, currentControlPoints);
          }
        });

        // After all the blockers are recursively set, set the current point
        setControlPoint(controlPoint);
      }
    };

    /**
     * Finds and returns the control point that will block setting the given control point
     *
     * @param {Object} controlPoint - The given control point to be set in the load profile instance
     * @param {Object} controlPoints - All the control points that the given control point needs to exist with
     * @returns
     */
    const findBlockers = (controlPoint, controlPoints) => {
      const index = controlPoints.findIndex((cp) => cp.id === controlPoint.id),
            blockers = [],
            marginValue = marginByDuration(this.xMax);

      let upperBlock;

      // We only check if the next point blocks, since the blocking relationship is mutual
      if (index + 1 < controlPoints.length) {
        const nextPoint = controlPoints[index + 1];

        if (nextPoint) {
          upperBlock = nextPoint.time.value;

          if (nextPoint.time?.margin) {
            upperBlock -= marginValue;
          }

          if (upperBlock < controlPoint.time?.value) {
            blockers.push(nextPoint);
          }
        }
      }

      return blockers;
    };

    /**
     * Function to set the time and/or load of a control point, using the existing setters.
     *
     * @param {Object} controlPoint - The control point object that needs to be set for the load profile.
     */
    const setControlPoint = (controlPoint) => {
      if (controlPoint && controlPoint.load && typeof controlPoint.load?.value !== 'undefined') {
        this.setLoadValue({ id: controlPoint.id, value: controlPoint.load.value });
      }

      if (controlPoint && controlPoint.time && typeof controlPoint.time?.value !== 'undefined') {
        this.setTimeValue({ id: controlPoint.id, value: controlPoint.time.value });
      }
    };

    Array.isArray(controlPoints) && controlPoints.map((cp) => {
      setControlPointRecursive(cp, controlPoints, currentControlPoints);
    });
  }

  /**
   * Return a plain Javascript object representation of this load profile. This is useful when this profile needs to be
   * sent over the wire, stored in memory, or manipulated by any other means.
   *
   * @return {object} A plain Javascript object representing this load profile.
   */
  toObject () {
    return {
      id: this.id,
      name: this.name,
      controlPoints: this.controlPoints,
      xMax: this.xMax,
      yMax: this.yMax,
      shorthand: this.shorthand,
      description: this.description
    };
  }
}

module.exports = LoadProfile;

/**
 * Finds the points between which the elapsed time lies.
 *
 * @param {ControlPoint[]} controlPoints - The control points of the curve.
 * @param {Number} elapsedDurationMs - The elapsed time in milliseconds.
 *
 * @returns {[ControlPoint,ControlPoint]} - The points between which the elapsed time lies.
 */
const findPoints = (controlPoints, elapsedDurationMs) => {
  let left, right;

  for (let point of controlPoints) {
    if (point.time.value < elapsedDurationMs) {
      left = point;
    }
    else {
      // to make sure that we have both the points
      if (!left) {
        left = point;
      }

      right = point;

      break;
    }
  }

  return [left, right];
};

/**
 * Restrict a numeric value within a range. Values which exceed the upper limit will be limited to the upper limit, or
 * one below the upper limit depending on the value of the "exclusive" parameter. Values which exceed the lower limit
 * will be limited to the lower limit or one above the lower limit depending on the value of the "exclusive" parameter.
 *
 * @param  {number} min - The lower end of the acceptable range.
 * @param  {number} input - The value to be clamped within the range.
 * @param  {number} max - The upper end of the acceptable range.
 * @param  {boolean} exclusive - Whether or not to include the lower/upper ends of the range when clamping.
 * @return {number} The clamped integer
 */
const clampInt = (min, input, max, exclusive) => {
  if (exclusive) {
    min += 1;
    max -= 1;
  }

  return Math.min(Math.max(input, min), max);
};

/**
 * Bins the time values for points based on the total duration to provide dynamic prevision
 * for the time handles on the load preview.
 *
 * @param {Object} params
 * @param {Object} params.value - The value of duration to be binned, in milliseconds
 * @param {Object} params.totalDuration - The total duration of the run
 *
 * @returns {Number} The binned value
 */
function binValueByDuration ({ value, totalDuration }) {
  const oneSecond = 1000, // milliseconds
        tenSeconds = 10 * oneSecond;

  // If the total duration is more than 10 minutes, bin the value to the nearest minute.
  if (totalDuration > 10 * MIN_TO_MS) {
    return Math.round(value / MIN_TO_MS) * MIN_TO_MS;
  }

  // If the total duration is between 1 and 10 minutes, bin the value to the nearest 10 seconds.
  else if (totalDuration > 1 * MIN_TO_MS && totalDuration <= 10 * MIN_TO_MS) {
    return Math.round(value / tenSeconds) * tenSeconds;
  }

  // If the total duration is less than 1 minute, bin the value to the nearest second.
  else {
    return Math.round(value / oneSecond) * oneSecond;
  }
}
