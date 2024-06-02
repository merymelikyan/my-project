const { SYSTEM_ERRORS } = require('./constants');

/**
 * Invoke a method on a subsystem
 *
 * *Warning: Don't use this method inside constructor of a subsystem. It might cause a circular dependency leading to failure to construct that class*
 *
 * @param {string} subsystemIdentifier - Subsystem name as per SUBSYSTEM_REGISTER
 * @param {object} [parameters] - Options to be passed to the method
 * @param {string} [parameters.action] - Action to be invoked in case of factory subsystem
 * @param {Array<any>} [parameters.args] - Arguments to be passed to the method
 * @param {PropertyKey} [parameters.method] - Method to be invoked
 * @param {PropertyKey} [parameters.property] - Property to be invoked
 * @param {boolean} [allowPrivateSubsystems=true] - Allow invoking private subsystems
 *
 * @throws {Error} - If the method is not found
 *
 * @example
 * // Invoke a method on a public subsystem like metricsSystem
 * invoke('metricsSystem', { method: 'getMetrics', args: ['network'] });
 *
 * // Create a workload manager instance from the factory
 * const {workloadId} = invoke('workloadManager', { action: 'create', args: [{context, options}] });
 *
 * // Invoke a method on a factory instance
 * invoke('workloadManager', { method: 'start', args: [workloadId] });
 *
 * @returns {Promise<any>}
 */
const invoke = (subsystemIdentifier, { action, args = [], method: target, property }, allowPrivateSubsystems = true) => {
  // Let's assume that property being accessed is a method.
  let targetSymbol = target;

  // If the target is a property, then invoke the property on the instance.
  if (property && !target) {
    targetSymbol = property;
  }

  // Disallow accessing private properties of the instances.
  if (targetSymbol?.startsWith('_')) {
    throw new Error(`Accessing private properties is not allowed. Tried to access ${targetSymbol} on ${subsystemIdentifier}`);
  }

  // Let's set the target instance to the singleton instance from public or private register.
  let singletonInstance = global.SUBSYSTEM_REGISTER.singletons?.[subsystemIdentifier];

  // If the subsystem is not found in the public register, then check if it is present in the private register.
  if (allowPrivateSubsystems && !singletonInstance) {
    singletonInstance = global.SUBSYSTEM_REGISTER.private?.[subsystemIdentifier];
  }

  // If instance is found, then invoke the targetSymbol on the instance.
  if (singletonInstance) {
    return (typeof singletonInstance?.[targetSymbol] === 'function') ? singletonInstance[targetSymbol](...args) : singletonInstance[targetSymbol];
  }
  else {
    // Fall back to factory subsystems.
    // If the target is a factory, then invoke the targetSymbol on the factory.
    const factory = global.SUBSYSTEM_REGISTER.factories?.[subsystemIdentifier];

    // If the target is a factory, then invoke the targetSymbol on the factory.
    if (factory && Object.keys(factory).includes(action)) {
      return (typeof factory[action] === 'function') ? factory[action](...args) : factory[action];
    }

    // If the invocation is meant for instance of the factory, then invoke the targetSymbol on the instance.
    // As per the format, the first argument is the id of the instance.
    // Rest of the args are the arguments to the targetSymbol
    // invoked on the instance.
    else if (factory && args?.length && factory.instances) {
      const instance = factory.instances.get(args[0]);

      if (!instance) {
        const err = new Error(`Instance of ${subsystemIdentifier} of the given ID not found while invoking ${targetSymbol}`);

        err.code = SYSTEM_ERRORS.INSTANCE_NOT_FOUND;

        throw err;
      }

      const invokedProperty = instance && instance[targetSymbol];

      if (invokedProperty === undefined) {
        const err = new Error(`Instance of ${subsystemIdentifier} does not have the property or function ${targetSymbol}`);

        err.code = SYSTEM_ERRORS.SYMBOL_NOT_FOUND;

        throw err;
      }

      // If the invoked property is a function, then invoke it with the rest of the args.
      if (typeof invokedProperty === 'function') {
        return instance[targetSymbol](...args.slice(1));
      }
      else if (invokedProperty !== undefined) {
        return invokedProperty;
      }
    }
  }

  throw new Error(`Either ${subsystemIdentifier} doesn't exist or no such ${targetSymbol ? `method ${targetSymbol}` : `action ${action}`} defined on ${subsystemIdentifier}`);
};

module.exports = invoke;
