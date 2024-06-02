/**
 * @typedef {Object} ControlPointVariables
 *
 * @property {Object.<String, Number>} variable - The variables used to configure the load profile control points.
 */

/**
 * @typedef {Object} ControlPoint
 *
 * @property {Object} time - The time of the control point.
 * @property {Number} time.value - The value of the time of the control point.
 * @property {Boolean} [time.anchor] - Whether the time of the control point is an anchor.
 * @property {Number} [time.defaultValue] - The default value of the time of the control point.
 * @property {Object} load - The load of the control point.
 * @property {Number} load.value - The value of the load of the control point.
 * @property {Boolean} [load.anchor] - Whether the load of the control point is an anchor.
 * @property {Number} [load.defaultValue] - The default value of the load of the control point.
 */

module.exports = {};
