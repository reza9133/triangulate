import { Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';

import { Layout } from './components/Layout';
import { LoadingBlock } from './components/Spinners';
import { About } from './pages/About';
import { Claim } from './pages/Claim';
import { Claims } from './pages/Claims';
import { DocsPage } from './pages/Docs';
import { Exam } from './pages/Exam';
import { Home } from './pages/Home';
import { Inspect } from './pages/Inspect';
import { NewClaim } from './pages/NewClaim';
import { NotFound } from './pages/NotFound';

export function App() {
  return (
    <Suspense fallback={<LoadingBlock text="Loading…" />}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="claims" element={<Claims />} />
          <Route path="claims/:claimId" element={<Claim />} />
          <Route path="exam/:examId" element={<Exam />} />
          <Route path="new" element={<NewClaim />} />
          <Route path="inspect" element={<Inspect />} />
          <Route path="docs" element={<DocsPage />} />
          <Route path="docs/:slug" element={<DocsPage />} />
          <Route path="about" element={<About />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
