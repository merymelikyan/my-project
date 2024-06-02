module.exports = {
  /**
   * The event name with which the renderer process will send the IPC messages
   * to the FS Interface residing in the main service
   */
  LOCAL_FILE_SYSTEM_EVENT_IDENTIFIER: 'performLocalFileSystemOperation',

  /**
   * Mapping of the event id's that we receive from the watchers
   * to user readable event names
   */
  FILE_WATCHER_ACTIONS: {
    0: 'created',
    1: 'deleted',
    2: 'modified',
    3: 'renamed'
  },

  /**
   * The event name with which the main process will send the IPC message to renderer service
   * indicating a file system event has been detected by the watcher in the main process
   */
  WATCHER_EVENT_IDENTIFIER: 'pathWatcherEvent',

  /**
   *  Encoding used while writing content to file paths
   *
   */
  ENCODING: 'utf-8',

  WRITE_STREAM_EVENTS: {
    FINISHED: 'finish',
    DRAINED: 'drain'
  },

  DIRECTORY_CHILDREN: {
    FILE: 'file',
    DIRECTORY: 'directory'
  },

  // Identifier of the File System node process
  FS_NODE_PROCESS: 'file_system_process'
};

