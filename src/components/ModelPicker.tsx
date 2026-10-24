import React, { useState } from 'react';
import type { AiSettings } from '../../electron/ai-types';
import { errorText } from '../lib/format';

const MANAGE = '__manage__';

/** Switches the active AI model in one click; the last option opens AI settings to edit the list. */
export function ModelPicker({ settings, onChange, onManage, disabled, className }: {
  settings: AiSettings;
  onChange: (settings: AiSettings) => void;
  onManage: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const [saving, setSaving] = useState(false);

  const select = async (value: string) => {
    if (value === MANAGE) return onManage();
    setSaving(true);
    try { onChange(await window.api.ai.updateSettings({ model: value })); }
    catch (e) { console.error(errorText(e)); }
    finally { setSaving(false); }
  };

  return (
    <select
      className={`model-picker ${className ?? ''}`}
      value={settings.model}
      onChange={e => select(e.target.value)}
      disabled={disabled || saving}
      title={`AI model: ${settings.model}`}
    >
      {settings.models.map(m => <option key={m} value={m}>{m}</option>)}
      <option disabled>──────────</option>
      <option value={MANAGE}>Manage models…</option>
    </select>
  );
}
