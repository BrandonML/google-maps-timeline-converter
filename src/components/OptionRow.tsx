import { useId, useState } from 'react';
import { Info } from 'lucide-react';

interface InfoTipProps {
  id: string;
  label: string;
  text: string;
}

/** Tooltip that opens on hover or keyboard focus, and closes with Escape. */
function InfoTip({ id, label, text }: InfoTipProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        aria-label={label}
        aria-describedby={id}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
        }}
        className="flex cursor-help rounded text-faint hover:text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <Info size={15} aria-hidden="true" />
      </button>
      {/* Positioned against the row's text column (not the icon) so it stays on screen on phones. */}
      <div
        id={id}
        role="tooltip"
        hidden={!open}
        className="pointer-events-none absolute bottom-full left-0 z-10 mb-2 w-[min(280px,100%)] rounded-[10px] bg-ink px-3.5 py-3 text-[13px] leading-normal text-white shadow-[0_12px_32px_-8px_rgb(0_0_0/0.3)]"
      >
        {text}
      </div>
    </>
  );
}

interface OptionRowProps {
  title: string;
  description: string;
  tip: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  isLast?: boolean;
}

export function OptionRow({ title, description, tip, checked, onChange, isLast = false }: OptionRowProps) {
  const uid = useId();
  const titleId = `${uid}-title`;
  const descId = `${uid}-desc`;
  const tipId = `${uid}-tip`;

  return (
    <div className={`flex items-start gap-3.5 py-3.5 ${isLast ? '' : 'border-b border-divider'}`}>
      <div className="relative min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span id={titleId} className="text-[15px] font-semibold">{title}</span>
          <InfoTip id={tipId} label={`More information about ${title}`} text={tip} />
        </div>
        <p id={descId} className="mt-[3px] text-[13.5px] leading-normal text-muted">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={titleId}
        aria-describedby={descId}
        onClick={() => onChange(!checked)}
        className={`mt-0.5 flex h-6 w-10 flex-none cursor-pointer rounded-full p-0.5 transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
          checked ? 'justify-end bg-primary' : 'justify-start bg-[oklch(0.86_0.008_260)]'
        }`}
      >
        <span className="h-5 w-5 rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.25)]" />
      </button>
    </div>
  );
}
