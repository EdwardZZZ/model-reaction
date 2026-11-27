/** Treat objects with Object.prototype or null as their prototype as plain objects. */
export function isPlainObject(value: object): boolean {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

/** Own enumerable string and Symbol keys, in property order. */
export function ownEnumerableKeys(value: object): (string | symbol)[] {
    return Reflect.ownKeys(value).filter((key) =>
        Object.prototype.propertyIsEnumerable.call(value, key)
    );
}
