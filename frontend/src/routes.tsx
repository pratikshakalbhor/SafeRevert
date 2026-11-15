import React from 'react';
import { Routes, Route, useParams, useNavigate } from 'react-router-dom';
import { AppLayout } from './components/AppLayout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { HomePage } from './pages/HomePage';
import { DashboardPage } from './pages/DashboardPage';
import { SendPage } from './pages/SendPage';
import { TransfersPage } from './pages/TransfersPage';
import { TransferDetailPage } from './pages/TransferDetailPage';
import { ClaimPage } from './pages/ClaimPage';
import { SecurityPage } from './pages/SecurityPage';
import { NotFoundPage } from './pages/NotFoundPage';

/**
 * Claim page bound to `/claim/:id`. Only the transfer id comes from the URL —
 * the secret is always typed in by the user and never placed in a link.
 */
const ClaimRoute: React.FC = () => {
  const { id } = useParams();
  const initialTransferId = id && /^\d+$/.test(id) ? BigInt(id) : null;
  return <ClaimPage initialTransferId={initialTransferId} />;
};

/** My transfers — routes a "claim" action to the claim page for that id. */
const TransfersRoute: React.FC = () => {
  const navigate = useNavigate();
  return (
    <TransfersPage
      onNavigateToClaim={(id) => navigate(`/claim/${id.toString()}`)}
    />
  );
};

/**
 * Route table. Everything renders inside the shared layout (banner, navbar,
 * footer); protected routes gate on a connected wallet.
 */
export const AppRoutes: React.FC = () => (
  <Routes>
    <Route element={<AppLayout />}>
      {/* Public pages */}
      <Route path="/" element={<HomePage />} />
      <Route path="/security" element={<SecurityPage />} />

      {/* Wallet = login */}
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <DashboardPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/send"
        element={
          <ProtectedRoute>
            <SendPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/transfers"
        element={
          <ProtectedRoute>
            <TransfersRoute />
          </ProtectedRoute>
        }
      />
      <Route
        path="/transfers/:id"
        element={
          <ProtectedRoute>
            <TransferDetailPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/claim"
        element={
          <ProtectedRoute>
            <ClaimRoute />
          </ProtectedRoute>
        }
      />
      <Route
        path="/claim/:id"
        element={
          <ProtectedRoute>
            <ClaimRoute />
          </ProtectedRoute>
        }
      />

      {/* Friendly 404 */}
      <Route path="*" element={<NotFoundPage />} />
    </Route>
  </Routes>
);
