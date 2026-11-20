import type { BusinessData, BusinessModel } from './business-model.js';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

type Name = Expect<Equal<BusinessData['name'], string>>;
type Status = Expect<Equal<BusinessData['status'], 'draft' | 'published'>>;
type Note = Expect<Equal<BusinessData['note'], string | undefined>>;
type Address = Expect<Equal<BusinessData['address'], { city: string }>>;
type Lines = Expect<Equal<BusinessData['lines'], { sku: string; qty: number }[]>>;

// Compile-only checks; never called by the runner. See ../SCHEMA_COMPOSITION.md.
function checkSetters(model: BusinessModel) {
  void model.setField('status', 'published');
  void model.setField('note', undefined);
  void model.setField('note', 'Delivery instructions');
  void model.setField('lines', [{ sku: 'pen', qty: 2 }]);
  // @ts-expect-error status must remain a closed literal union
  void model.setField('status', 'deleted');
  // @ts-expect-error quantity must remain numeric
  void model.setField('lines', [{ sku: 'pen', qty: 'two' }]);
  // @ts-expect-error unknown fields must remain rejected
  void model.setField('missing', 1);
}
