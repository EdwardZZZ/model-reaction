import { useCallback, useRef, useState, type FormEvent } from 'react';
import { InputFields, type FormModel, type Payload, type InputStatus } from './support';
export function Form({ model, save }: { model: FormModel; save: (payload: Payload) => Promise<void> }) {
  const lock = useRef(false);
  const input = useRef<InputStatus>({ pending: false, writeError: null });
  const onStatus = useCallback((status: InputStatus) => { input.current = status; }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      await model.settled();
      if (input.current.writeError) throw input.current.writeError;
      if (!await model.validateAll()) throw new Error('Invalid form');
      if (input.current.writeError) throw input.current.writeError;
      await save(model.data);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { lock.current = false; setBusy(false); }
  }
  return <form onSubmit={submit}>
    <InputFields model={model} disabled={busy} onStatus={onStatus} />
    <button type="submit" disabled={busy}>Save</button><span data-testid="submit-error">{error}</span>
  </form>;
}
