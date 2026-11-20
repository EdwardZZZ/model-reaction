const utilities = `
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;
`;
export function typeAssertions(id) {
  if (id === 'AI-01') return utilities + `
import { createUserModel } from './solution';
const m = createUserModel();
type Name = Expect<Equal<typeof m.data.name, string>>;
type Age = Expect<Equal<typeof m.data.age, number>>;
// @ts-expect-error unknown field
m.setField('missing', 1);
// @ts-expect-error wrong age type
m.setField('age', '21');
// @ts-expect-error wrong name type
m.setField('name', 21);
`;
  if (id === 'AI-11') return utilities + `
import { createBusinessModel } from './solution';
const m = createBusinessModel();
type Name = Expect<Equal<typeof m.data.name, string>>;
type Status = Expect<Equal<typeof m.data.status, 'draft' | 'published'>>;
type Note = Expect<Equal<typeof m.data.note, string | undefined>>;
type City = Expect<Equal<typeof m.data.address.city, string>>;
type Line = Expect<Equal<typeof m.data.lines[number], { sku: string; qty: number }>>;
// @ts-expect-error invalid enum
m.setField('status', 'deleted');
// @ts-expect-error invalid qty
m.setField('lines', [{sku: 'pen', qty: 'two'}]);
// @ts-expect-error unknown field
m.setField('missing', 1);
m.setField('note', undefined);
m.setField('note', 'hello');
m.setField('status', 'published');
`;
  return 'export {};\n';
}
