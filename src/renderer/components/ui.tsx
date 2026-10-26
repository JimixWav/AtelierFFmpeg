import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { ItemStatus, JobState } from '../../shared/types';
import { Icon, type IconName } from './Icon';

/* ------------------------------------------------------------------ */
/* Boutons                                                             */
/* ------------------------------------------------------------------ */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  children, onClick, variant = 'secondary', icon, disabled, size = 'md', title, type = 'button', busy,
}: {
  children?: ReactNode;
  onClick?: () => void;
  variant?: ButtonVariant;
  icon?: IconName;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  title?: string;
  type?: 'button' | 'submit';
  busy?: boolean;
}) {
  return (
    <button
      type={type}
      className={`btn btn-${variant} btn-${size}${busy ? ' is-busy' : ''}`}
      onClick={onClick}
      disabled={disabled || busy}
      title={title}
      aria-busy={busy || undefined}
    >
      {busy ? <span className="spinner" aria-hidden="true" /> : icon ? <Icon name={icon} size={size === 'sm' ? 14 : 16} /> : null}
      {children ? <span>{children}</span> : null}
    </button>
  );
}

export function IconButton({ icon, label, onClick, disabled, tone }: { icon: IconName; label: string; onClick: () => void; disabled?: boolean; tone?: 'danger' }) {
  return (
    <button type="button" className={`icon-btn${tone ? ` tone-${tone}` : ''}`} onClick={onClick} disabled={disabled} aria-label={label} title={label}>
      <Icon name={icon} size={15} />
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Contrôles                                                           */
/* ------------------------------------------------------------------ */

export function Segmented<T extends string | number>({
  value, options, onChange, label, size = 'md',
}: {
  value: T;
  options: { value: T; label: string; hint?: string; disabled?: boolean }[];
  onChange: (v: T) => void;
  label: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div className={`segmented segmented-${size}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? 'is-active' : ''}
          disabled={o.disabled}
          title={o.hint}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Checkbox({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; description?: ReactNode }) {
  const id = useId();
  return (
    <label className="checkbox" htmlFor={id}>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="checkbox-box" aria-hidden="true">
        <Icon name="check" size={12} />
      </span>
      <span className="checkbox-text">
        <span className="checkbox-label">{label}</span>
        {description ? <span className="checkbox-desc">{description}</span> : null}
      </span>
    </label>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="switch" onClick={() => onChange(!checked)}>
      <span className="switch-track" aria-hidden="true">
        <span className="switch-thumb" />
      </span>
      <span>{label}</span>
    </button>
  );
}

export function Collapsible({ title, children, defaultOpen = false, aside }: { title: string; children: ReactNode; defaultOpen?: boolean; aside?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className={`collapsible${open ? ' is-open' : ''}`}>
      <button type="button" className="collapsible-head" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <Icon name="chevronRight" size={14} className="collapsible-chevron" />
        <span>{title}</span>
        {aside ? <span className="collapsible-aside">{aside}</span> : null}
      </button>
      <div id={id} className="collapsible-body" hidden={!open}>
        {children}
      </div>
    </div>
  );
}

/** Petite icône « i » qui affiche une info-bulle au survol ou au focus clavier. */
export function InfoTip({ text, label = 'Plus d’informations' }: { text: ReactNode; label?: string }) {
  const id = useId();
  const [align, setAlign] = useState<'right' | 'left'>('right');
  // La bulle s'ouvre vers la gauche ; si elle sortait de la zone de contenu, on l'ouvre vers la droite.
  const place = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const area = (el.closest('.main, .modal') as HTMLElement | null)?.getBoundingClientRect();
    const minLeft = (area?.left ?? 0) + 12;
    setAlign(r.right + 8 - 240 < minLeft ? 'left' : 'right');
  };
  return (
    <span className={`infotip align-${align}`} onPointerEnter={(e) => place(e.currentTarget)} onFocus={(e) => place(e.currentTarget)}>
      <span
        className="infotip-btn"
        role="button"
        tabIndex={0}
        aria-label={label}
        aria-describedby={id}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
        }}
      >
        <Icon name="info" size={13} />
      </span>
      <span id={id} role="tooltip" className="infotip-bubble">
        {text}
      </span>
    </span>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="field">
      <div className="field-label">{label}</div>
      <div className="field-control">{children}</div>
      {hint ? <div className="field-hint">{hint}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Progression : vumètre segmenté                                      */
/* ------------------------------------------------------------------ */

export function Meter({ value, segments = 48, label, size = 'lg' }: { value: number | null; segments?: number; label: string; size?: 'lg' | 'sm' }) {
  const indeterminate = value === null;
  const filled = indeterminate ? 0 : Math.round(Math.max(0, Math.min(1, value)) * segments);
  return (
    <div
      className={`meter meter-${size}${indeterminate ? ' is-indeterminate' : ''}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round((value ?? 0) * 100)}
    >
      {Array.from({ length: segments }, (_, i) => (
        <span key={i} className={i < filled ? (i === filled - 1 ? 'on lead' : 'on') : ''} />
      ))}
    </div>
  );
}

export function Bar({ value }: { value: number | null }) {
  return (
    <div className={`bar${value === null ? ' is-indeterminate' : ''}`} aria-hidden="true">
      <span style={{ width: value === null ? undefined : `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Statuts                                                             */
/* ------------------------------------------------------------------ */

export const ITEM_STATUS: Record<ItemStatus, { label: string; tone: string; icon: IconName }> = {
  pending: { label: 'En attente', tone: 'neutral', icon: 'history' },
  running: { label: 'En cours', tone: 'signal', icon: 'play' },
  done: { label: 'Terminé', tone: 'ok', icon: 'check' },
  skipped: { label: 'Ignoré', tone: 'muted', icon: 'skip' },
  failed: { label: 'Échec', tone: 'danger', icon: 'alert' },
  cancelled: { label: 'Annulé', tone: 'muted', icon: 'x' },
};

export const JOB_STATE: Record<JobState, { label: string; tone: string }> = {
  queued: { label: 'En attente', tone: 'neutral' },
  running: { label: 'En cours', tone: 'signal' },
  paused: { label: 'En pause', tone: 'warn' },
  done: { label: 'Terminé', tone: 'ok' },
  'done-with-errors': { label: 'Terminé avec erreurs', tone: 'warn' },
  cancelled: { label: 'Annulé', tone: 'muted' },
  failed: { label: 'Erreur', tone: 'danger' },
};

export function Pill({ tone, children, icon }: { tone: string; children: ReactNode; icon?: IconName }) {
  return (
    <span className={`pill tone-${tone}`}>
      {icon ? <Icon name={icon} size={12} /> : <span className="pill-dot" aria-hidden="true" />}
      {children}
    </span>
  );
}

export function Notice({ tone = 'info', title, children, action }: { tone?: 'info' | 'warn' | 'danger' | 'ok'; title?: ReactNode; children?: ReactNode; action?: ReactNode }) {
  const icon: IconName = tone === 'ok' ? 'check' : tone === 'info' ? 'info' : 'alert';
  return (
    <div className={`notice tone-${tone}`} role={tone === 'danger' ? 'alert' : undefined}>
      <Icon name={icon} size={16} className="notice-icon" />
      <div className="notice-body">
        {title ? <div className="notice-title">{title}</div> : null}
        {children ? <div className="notice-text">{children}</div> : null}
      </div>
      {action ? <div className="notice-action">{action}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Fenêtre modale                                                      */
/* ------------------------------------------------------------------ */

export function Modal({ title, children, footer, onClose, wide }: { title: string; children: ReactNode; footer?: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const node = ref.current;
    node?.querySelector<HTMLElement>('button.btn-primary, button, [tabindex]')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && node) {
        const f = [...node.querySelectorAll<HTMLElement>('button:not([disabled]), input, select, [tabindex="0"]')];
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus();
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="modal-head">
          <h2>{title}</h2>
          <IconButton icon="x" label="Fermer" onClick={onClose} />
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */

export interface Toast {
  id: number;
  tone: 'ok' | 'info' | 'warn' | 'danger';
  text: string;
}

export function Toasts({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast tone-${t.tone}`}>
          <Icon name={t.tone === 'ok' ? 'check' : t.tone === 'info' ? 'info' : 'alert'} size={15} />
          <span>{t.text}</span>
          <IconButton icon="x" label="Fermer la notification" onClick={() => dismiss(t.id)} />
        </div>
      ))}
    </div>
  );
}
