import { useEffect, useState } from 'react';
import { useDraftField } from 'model-reaction/react';
import type { EditorProps, EditorModel } from './support';
function Input({ model }: { model: EditorModel }) {
  const field = useDraftField(model, 'name');
  return <><input aria-label="name" value={field.draft} onChange={e => field.setDraft(e.target.value)} onBlur={field.onBlur} />
    <span data-testid="name-error">{field.writeError?.message ?? field.meta.error}</span></>;
}
function Owner({ recordId, factory, record }: EditorProps) {
  const [model, setModel] = useState<EditorModel | null>(null);
  useEffect(() => {
    const next = factory(recordId);
    const off = next.subscribe(d => d.name, name => record(recordId, name));
    setModel(next);
    return () => { off(); next.dispose(); };
  }, [recordId, factory, record]);
  return model ? <Input key={recordId} model={model} /> : null;
}
export function Editor(props: EditorProps) { return <Owner key={props.recordId} {...props} />; }
