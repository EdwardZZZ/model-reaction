export function ownEnumerableKeys(value: object): (string | symbol)[] {
    return Reflect.ownKeys(value).filter((key) =>
        Object.prototype.propertyIsEnumerable.call(value, key)
    );
}
