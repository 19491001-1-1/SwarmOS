import { useState } from 'react';

type Props = {
  error?: string;
  onSignIn: (token: string) => Promise<void>;
};

export function LoginView({ error, onSignIn }: Props) {
  const [token, setToken] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!token.trim() || submitting) return;
    setSubmitting(true);
    try {
      await onSignIn(token.trim());
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="login-shell">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">Crewden</div>
        <label className="login-label" htmlFor="web-auth-token">Access token</label>
        <input
          id="web-auth-token"
          className="login-input"
          type="password"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          autoFocus
          autoComplete="current-password"
        />
        {error ? <div className="login-error">{error}</div> : null}
        <button className="login-button" type="submit" disabled={!token.trim() || submitting}>
          {submitting ? 'Signing in...' : 'Sign in'}
        </button>
        <p className="login-hint">Ask the workspace owner for an access token.</p>
      </form>
    </main>
  );
}
