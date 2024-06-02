/**
 * Used to maintain percentile information for the metrics system needed for performance testing.
 * The percentile is provided using max heap and add/remove operations on it
 */
class MedianCalculator {
  constructor () {
    this.values = [];
  }

  _getLeftChildIndex (parentIndex) {
    return 2 * parentIndex + 1;
  }
  _getRightChildIndex (parentIndex) {
    return 2 * parentIndex + 2;
  }

  _getParentIndex (childIndex) {
    return Math.floor((childIndex - 1) / 2);
  }

  _hasLeftChild (index) {
    return this._getLeftChildIndex(index) < this.values.length;
  }

  _hasRightChild (index) {
    return this._getRightChildIndex(index) < this.values.length;
  }

  _hasParent (index) {
    return this._getParentIndex(index) >= 0;
  }

  _leftChild (index) {
    return this.values[this._getLeftChildIndex(index)];
  }

  _rightChild (index) {
    return this.values[this._getRightChildIndex(index)];
  }

  _parent (index) {
    return this.values[this._getParentIndex(index)];
  }

  _swap (index1, index2) {
    [this.values[index1], this.values[index2]] = [this.values[index2], this.values[index1]];
  }

  _remove () {
    if (this.values.length === 0) {
      return null;
    }
    const item = this.values[0];
    this.values[0] = this.values[this.values.length - 1];
    this.values.pop();
    this._heapifyDown();

    return item;
  }

  /**
   * Adds the value in the heap and then heapifies the heap to maintain max value at the top.
   *
   * @param {Number} value - The integer value to be added in the heap
   */
  add (value) {
    this.values.push(value);
    this._heapifyUp();
  }

  _heapifyUp () {
    let index = this.values.length - 1;
    while (this._hasParent(index) && this._parent(index) < this.values[index]) {
      this._swap(this._getParentIndex(index), index);
      index = this._getParentIndex(index);
    }
  }

  _heapifyDown () {
    let index = 0;
    while (this._hasLeftChild(index)) {
      let largerChildIndex = this._getLeftChildIndex(index);
      if (this._hasRightChild(index) && this._rightChild(index) > this._leftChild(index)) {
        largerChildIndex = this._getRightChildIndex(index);
      }
      if (this.values[index] > this.values[largerChildIndex]) {
        break;
      } else {
        this._swap(index, largerChildIndex);
      }
      index = largerChildIndex;
    }
  }

  /**
   * Returns the percentiles needed by the metric system
   * @returns {Object} - returns the 90, 95 and 99 percentile in the format
   *                     {percentile90: --, percentile95: --, percentile99: --}
   */
  getPercentile () {
    const percentile90Index = Math.floor(this.values.length * 0.1), // index for 90th percentile
      percentile95Index = Math.floor(this.values.length * 0.05), // index for 95th percentile
      percentile99Index = Math.floor(this.values.length * 0.01); // index for 99th percentile
    let index = percentile90Index;

    const poppedMetricValues = [];

    while (index >= 0) {
      poppedMetricValues.push(this._remove());
      index--;
    }

    const percentiles = {
      percentile90: poppedMetricValues[percentile90Index],
      percentile95: poppedMetricValues[percentile95Index],
      percentile99: poppedMetricValues[percentile99Index]
    };

    for (const value of poppedMetricValues) {
      this.add(value);
    }

    return percentiles;
  }
}

module.exports = MedianCalculator;
