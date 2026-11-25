/** Treat objects with Object.prototype or null as their prototype as plain objects. */
export function isPlainObject(value: object): boolean {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
