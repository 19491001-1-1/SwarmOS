type Props = {
  title: string;
  subtitle?: string;
  hasThread: boolean;
  onOpenMenu: () => void;
  onOpenAgents: () => void;
  onCloseThread?: () => void;
};

export function MobileTopBar({ title, subtitle, hasThread, onOpenMenu, onOpenAgents, onCloseThread }: Props) {
  return (
    <div className="mobile-topbar">
      <button type="button" className="mobile-topbar-button" onClick={onOpenMenu} aria-label="Open navigation">
        ☰
      </button>
      <div className="mobile-topbar-title">
        <strong>{title}</strong>
        {subtitle ? <span>{subtitle}</span> : null}
      </div>
      {hasThread ? (
        <button type="button" className="mobile-topbar-button" onClick={onCloseThread} aria-label="Close thread">
          ×
        </button>
      ) : (
        <button type="button" className="mobile-topbar-button" onClick={onOpenAgents} aria-label="Open agents">
          ◇
        </button>
      )}
    </div>
  );
}
