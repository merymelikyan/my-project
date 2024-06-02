
module.exports = function () {
  let broadcastChannel = pm.eventBus.channel('waterline-shared-nedb-datastore'),
      isSharedProcess = false;

  return {
    adapter: 'waterline-shared-nedb',
    master: isSharedProcess,
    send: function (data) {
      broadcastChannel.publish(data);
    },
    listen: function (cb) {
      broadcastChannel.subscribe(cb);
    }
  };
};