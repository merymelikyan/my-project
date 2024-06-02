// As of now we are concerned with only the firs app launch, so we will
// neglect any subsequent events post the first launch.

exports.PERF_MARKS = {
  // Below marks will be called once throughout app lifecycle
  MAIN_PROCESS_IMPORTS_COMPLETE: 'main-process-imports-complete',
  MAIN_PROCESS_APP_READY: 'main-process-app-ready',

  // Below marks will be called more than once throughout app lifecycle
  MAIN_PROCESS_BROWSER_OPEN_COMPLETE: 'main-process-browser-open-complete'
};
exports.PERF_MEASURES = {
  // Below marks will be called once throughout app lifecycle
  MAIN_PROCESS_IMPORTS_TIME: 'main-process-imports-time',
  MAIN_PROCESS_APP_READY_TIME: 'main-process-app-ready-time',

  // Below marks will be called more than once throughout app lifecycle
  MAIN_PROCESS_BROWSER_OPEN_TIME: 'main-process-browser-open-time',
  MAIN_PROCESS_SHELL_LAUNCH_TIME: 'main-process-shell-launch-time'
};
