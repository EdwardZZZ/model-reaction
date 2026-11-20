import type { BusinessData, BusinessModel } from './business-model.js';

export function changeCity(model: BusinessModel, city: string) {
  return model.setField('address', { ...model.data.address, city });
}

export function appendLine(model: BusinessModel, line: BusinessData['lines'][number]) {
  return model.setField('lines', [...model.data.lines, { ...line }]);
}
