const { Heap } = require('heap-js');

/**
 * A heap data structure that stores the nodes in a map. This allows us to access the nodes in O(1) time (top or by ID).
 * as well as perform the heap operations in O(log n) time. Such that insert, remove, update, addAll takes O(log n) time.
 *
 * It will give us the best of both worlds Heap and Map with the cost of extra memory.
 */
class ExtendedHeap {
  #nodes;
  #heap;
  comparator;

  constructor (comparator) {
    this.comparator = comparator;
    this.#heap = new Heap(comparator);
    this.#nodes = new Map();
  }

  /**
   * Performs a pushpop operation on the heap.
   *
   * @param {*} node
   *
   * @returns {*}
   */
  pushpop = (node) => {
    this.#nodes.set(node.id, node);

    const topINode = this.#heap.pushpop(node);

    this.#nodes.delete(topINode.id);

    return topINode;
  }

  /**
   * Performs a replace operation on the heap.
   *
   * @param {*} node
   *
   * @returns {*}
   */
  replace = (node) => {
    this.#nodes.set(node.id, node);

    const topINode = this.#heap.replace(node);

    // Remove the node from the map only if it was replaced.
    if (topINode?.id) {
      this.#nodes.delete(topINode.id);
    }

    return topINode;
  }

  /**
   * Update the node in the heap.
   */
  update = (node) => {
    // Remove the node from the heap and add it again.
    const isRemoved = this.#heap.remove(node, ({ id }) => id === node.id);

    // Only add the node if it was removed from the heap.
    const isAdded = isRemoved && this.#heap.add(node);

    // Update the node in the map only if it was removed and added to the heap.
    if (isRemoved && isAdded) {
      this.#nodes.set(node.id, node);
    }

    return isRemoved && isAdded;
  }

  /**
   * Clones the heap.
   *
   * @returns {ExtendedHeap}
   */
  clone = () => {
    const heap = new ExtendedHeap(this.comparator);

    heap.addAll(this.#heap.toArray());

    return heap;
  };

  /**
   * Returns the top node from the heap.
   *
   * @returns {*}
   */
  pop = () => {
    const node = this.#heap.pop();

    if (node?.id) {
      this.#nodes.delete(node.id);
    }

    return node;
  }

  /**
   * Checks if the node exists in the heap or not.
   */
  has = (nodeId) => {
    return this.#nodes.has(nodeId);
  }

  /**
   * Inserts a node in the heap.
   */
  add = (node) => {
    // If the node is an array then add all the nodes in the heap using more efficient method.
    if (Array.isArray(node)) {
      return this.addAll(node);
    }
    else {
      const isAdded = this.#heap.add(node);

      if (isAdded) {
        this.#nodes.set(node.id, node);
      }

      return isAdded;
    }
  }

  /**
   * Removes a node from the heap.
   */
  remove = (nodeId) => {
    const node = this.#nodes.get(nodeId);
    const isRemoved = this.#heap.remove(node, ({ id }) => id === nodeId);

    if (isRemoved) {
      this.#nodes.delete(nodeId);
    }

    return isRemoved;
  }

  /**
   * Returns the node from the heap.
   */
  get = (nodeId) => {
    return this.#nodes.get(nodeId);
  }

  /**
   * Adds multiple nodes in the heap.
   */
  addAll = (nodes) => {
    for (const node of nodes) {
      this.#nodes.set(node.id, node);
    }

    return this.#heap.addAll(nodes);
  }

  /**
   * Clears the heap.
   */
  clear = () => {
    this.#nodes.clear();

    return this.#heap.clear();
  }

  // Aliases as supported by Heap library.
  removeAll = this.clear;
  insert = this.add;
  push = this.add;
  offer = this.push;
  poll = this.pop;
  contains = this.has;
  size = () => this.#heap.size();
  isEmpty = () => this.#heap.isEmpty();
  toArray = () => this.#heap.toArray();
  peek = () => this.#heap.peek();
  element = () => this.#heap.peek();
  toString = () => this.#heap.toString;
}

module.exports = ExtendedHeap;
