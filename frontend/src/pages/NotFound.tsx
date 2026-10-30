import { Link } from 'react-router-dom';

import { LogoMark } from '../components/Logo';

export function NotFound() {
  return (
    <div className="container section" style={{ textAlign: 'center' }}>
      <LogoMark size={96} />
      <h1 style={{ fontSize: '2.4rem', marginTop: 18 }}>No fix on this position</h1>
      <p className="lead" style={{ margin: '0 auto 24px' }}>
        The page you asked for does not exist. Three bearings, no intersection.
      </p>
      <Link className="btn primary" to="/">
        Back to the start
      </Link>
    </div>
  );
}
