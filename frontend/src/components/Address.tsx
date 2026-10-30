import { explorerAddress } from '../lib/config';
import { shortAddress } from '../lib/format';

export function Address({ value }: { value: string }) {
  return (
    <a className="mono" href={explorerAddress(value)} target="_blank" rel="noreferrer" title={value}>
      {shortAddress(value)}
    </a>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="notice tone-bad" role="alert">
      <strong>Could not load.</strong> {message}
      {onRetry ? (
        <div style={{ marginTop: 10 }}>
          <button className="btn small" onClick={onRetry}>
            Try again
          </button>
        </div>
      ) : null}
    </div>
  );
}
