import { useState, type FormEvent } from 'react';

export function NameForm({
  initialName = '',
  onSubmit,
}: {
  initialName?: string;
  onSubmit: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSubmit(name);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="name-form" onSubmit={submit}>
      <label htmlFor="display-name">Nickname</label>
      <div className="inline-form-row">
        <input
          autoFocus
          id="display-name"
          maxLength={20}
          onChange={event => setName(event.target.value)}
          placeholder="Choose a unique name"
          value={name}
        />
        <button disabled={!name.trim() || saving} type="submit">
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </form>
  );
}
