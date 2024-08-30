/**
 * Checks if the given value is an Error object or has Error-like properties.
 *
 * This function performs type checking to determine if the provided value
 * is either an instance of Error or an object with 'name' and 'message'
 * properties of type string, which are characteristic of Error objects.
 *
 * @param value - The value to be checked.
 * @returns True if the value is an Error or Error-like object, false otherwise.
 *
 * @example
 * const err = new Error('Something went wrong');
 * console.log(isError(err)); // true
 *
 * const notError = { foo: 'bar' };
 * console.log(isError(notError)); // false
 */
export const isError = (value: unknown): value is Error => {
  return (
    value instanceof Error ||
    (typeof value === 'object' &&
      value !== null &&
      'name' in value &&
      'message' in value &&
      typeof (value as Error).name === 'string' &&
      typeof (value as Error).message === 'string')
  )
}
