// If x and y are not explicitly defined, default position of window is center.
const DEFAULT_REQUESTER_BOUNDS = { x: null, y: null, width: 1280, height: 800 };
const DEFAULT_RUNNER_BOUNDS = { x: null, y: null, width: 1280, height: 800 };
const DEFAULT_CONSOLE_BOUNDS = { x: null, y: null, width: 900, height: 600 };
const MAC_TRAFFIC_LIGHTS_POSITIONS_DEFAULT = { x: 12, y: 17 };
const MAC_TRAFFIC_LIGHTS_Y_POSITION_FOR_ZOOM = {
  0.25: 0,
  0.33: 1,
  0.5: 5,
  0.67: 9,
  0.75: 11,
  0.8: 12.2,
  0.9: 14.6,
  1.0: 16,
  1.1: 19.4,
  1.25: 23,
  1.5: 29,
  1.75: 35,
  2.0: 41,
  2.5: 53,
  3.0: 65,
  4.0: 89,
  5.0: 113
};
const MIN_ALLOWED_WINDOW_WIDTH = 450;
const MIN_ALLOWED_REQUESTER_WIDTH = 640;
const MIN_ALLOWED_WINDOW_HEIGHT = 224;

module.exports = {
  DEFAULT_REQUESTER_BOUNDS,
  DEFAULT_CONSOLE_BOUNDS,
  DEFAULT_RUNNER_BOUNDS,
  MIN_ALLOWED_WINDOW_WIDTH,
  MIN_ALLOWED_REQUESTER_WIDTH,
  MIN_ALLOWED_WINDOW_HEIGHT,
  MAC_TRAFFIC_LIGHTS_POSITIONS_DEFAULT,
  MAC_TRAFFIC_LIGHTS_Y_POSITION_FOR_ZOOM
};
