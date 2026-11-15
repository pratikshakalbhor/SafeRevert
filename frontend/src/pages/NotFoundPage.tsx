import React from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, Home } from 'lucide-react';

export const NotFoundPage: React.FC = () => {
  return (
    <div className="max-w-lg mx-auto px-4 py-20 text-center">
      <div className="glass-card p-10 space-y-4">
        <div className="font-display text-6xl font-bold text-copper-400">404</div>
        <div className="w-12 h-12 mx-auto rounded-2xl bg-copper-500/10 border border-copper-500/30 flex items-center justify-center text-copper-400">
          <AlertCircle className="w-6 h-6" />
        </div>
        <h1 className="text-xl font-bold text-silver-100">Page not found</h1>
        <p className="text-sm text-silver-400 leading-relaxed">
          That URL doesn&apos;t match any page in SafeRevert. Nothing was sent
          and no funds were touched — this is only a navigation mistake.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-1">
          <Link
            to="/"
            className="btn-primary px-5 py-2.5 text-sm inline-flex items-center gap-2"
          >
            <Home className="w-4 h-4" /> Back to home
          </Link>
          <Link
            to="/send"
            className="btn-secondary px-5 py-2.5 text-sm inline-flex items-center gap-2"
          >
            Create a transfer
          </Link>
        </div>
      </div>
    </div>
  );
};
