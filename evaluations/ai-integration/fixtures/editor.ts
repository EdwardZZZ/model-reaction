import { createModel } from 'model-reaction';
import { ValidationRules as V } from 'model-reaction/validation';

export type RecordId = 'A' | 'B';
export function createEditorModel(
  recordId: RecordId,
  check: (name: string) => Promise<boolean> = async () => true,
) {
  return createModel({ name: { type: 'string', default: recordId === 'A' ? 'Ada' : 'Bob',
    validator: [V.required, { type: 'check', message: 'Name unavailable', validate: check }] } });
}
export type EditorModel = ReturnType<typeof createEditorModel>;
export interface EditorProps {
  recordId: RecordId;
  factory: (id: RecordId) => EditorModel;
  record: (id: RecordId, name: string) => void;
}
