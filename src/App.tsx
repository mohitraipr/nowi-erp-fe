import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/auth';
import { AppToaster, ToastProvider } from './components/ui/toast';
import ProtectedRoute from './components/ProtectedRouteV2';
// import PlaceholderSection from './components/PlaceholderSection'; // TODO: re-enable when commented stub routes return
import Onboarding from './components/Onboarding';
import { ErrorBoundary } from './components/ErrorBoundary';
import { hideSplash } from './native/capacitor-init';
import { markChunkLoadSucceeded } from './lib/chunk-reload';

import Login from './pages/Login';
import SsoSkucast from './pages/SsoSkucast';
import Dashboard from './pages/Dashboard';
import { useAuth } from './context/auth';
import {
  hasAnyRole,
  hasRole,
  DESIGN_SUBMIT_ROLES,
  DISPATCH_VIEW_ROLES,
  PRODUCTION_BOARD_READ_ROLES,
  PRODUCTION_READ_ROLES,
} from './lib/userRoles';
import type { UserRole } from './api/types';

const AdminShell = lazy(() => import('./components/layout/AdminShell'));
const Home = lazy(() => import('./pages/Home'));
const Locator = lazy(() => import('./pages/admin/Locator'));
const SkuDetail = lazy(() => import('./pages/admin/SkuDetail'));
const Dispatches = lazy(() => import('./pages/admin/Dispatches'));
const DispatchDetail = lazy(() => import('./pages/admin/DispatchDetail'));
const Warehouses = lazy(() => import('./pages/admin/Warehouses'));
const ProductionKpis = lazy(() => import('./pages/admin/ProductionKpis'));
const SalesKpis = lazy(() => import('./pages/admin/SalesKpis'));
const InventoryHealth = lazy(() => import('./pages/admin/InventoryHealth'));
const Production = lazy(() => import('./pages/admin/Production'));
const ProductionLotDetail = lazy(() => import('./pages/admin/ProductionLotDetail'));
const StitchingHome = lazy(() => import('./pages/stitching/StitchingHome'));
const StitchingReceiveLot = lazy(
  () => import('./pages/stitching/StitchingReceiveLot'),
);
const StitchingWorkedOnDetail = lazy(
  () => import('./pages/stitching/StitchingWorkedOnDetail'),
);
const ReceiveFromKotty = lazy(
  () => import('./pages/stitching/ReceiveFromKotty'),
);
const FinishingHome = lazy(() => import('./pages/finishing/FinishingHome'));
const FinishingReceiveLot = lazy(
  () => import('./pages/finishing/FinishingReceiveLot'),
);
const FinishingWorkedOnDetail = lazy(
  () => import('./pages/finishing/FinishingWorkedOnDetail'),
);
const FloorHome = lazy(() => import('./pages/floor/FloorHome'));
const FloorEditLot = lazy(() => import('./pages/floor/FloorEditLot'));
const FloorLotDetail = lazy(() => import('./pages/floor/FloorLotDetail'));
const DataHome = lazy(() => import('./pages/data/DataHome'));
const UsersPage = lazy(() => import('./pages/admin/Users'));
const EditRequestsPage = lazy(() => import('./pages/admin/EditRequests'));
const DispatchPrint = lazy(() => import('./pages/dispatches/DispatchPrint'));
const CadPreviewPage = lazy(() => import('./pages/cad/CadPreviewPage'));
const ChinaImportRegistry = lazy(
  () => import('./pages/china-import/ChinaImportRegistry'),
);
const NewIntake = lazy(() => import('./pages/styles/NewIntake'));
const StyleWorkspace = lazy(() => import('./pages/styles/StyleWorkspace'));
const FabricLibrary = lazy(() => import('./pages/fabric-library/FabricLibrary'));
const ReceiveFabricChallan = lazy(
  () => import('./pages/fabric-library/ReceiveFabricChallan'),
);

function PageSkeleton() {
  // Inline shimmer — calm, sits inside whatever shell already rendered
  // (AdminShell sidebar, FloorShell header). Replaces the old fullscreen
  // centered pulse-bar that visually competed with the sidebar logo.
  return (
    <div className="space-y-3 p-4">
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

function S({ children }: { children: ReactNode }) {
  return <Suspense fallback={<PageSkeleton />}>{children}</Suspense>;
}

// Office roles that land on the unified Home (`/`). Floor roles
// (floor_manager / stitching_master / finishing_master) are excluded —
// they're bounced to their own data-entry homes. Mirrors the Home
// allow-list in docs/DASHBOARD_REDESIGN.md and ROLE_HOMES in Dashboard.tsx.
const OFFICE_HOME_ROLES: UserRole[] = [
  'admin',
  'viewer',
  'sampling_editor',
  'sampling_lead',
  // Production admin lands on the office Home (mirrors the BE dashboard
  // OFFICE_ROLES); floor_manager does NOT.
  'production_lead',
  // Cataloguer lands on the office Home to find its cataloguing queue.
  'cataloguer',
  // Fabric desk lands on the office Home (its chosen home).
  'fabric_manager',
];

/**
 * Index of the `/` AdminShell route. Office roles see the unified Home;
 * floor/stage roles fall through to <Dashboard/>, the role router that
 * redirects them to /floor, /stitching or /finishing. Keeps `/` a single
 * canonical entry point without a redirect loop.
 */
function HomeRoute() {
  const { user } = useAuth();
  if (hasAnyRole(user, OFFICE_HOME_ROLES)) {
    return <Home />;
  }
  // Submit-only role has no dashboard — drop it straight onto the intake form.
  if (hasRole(user, 'design_submitter')) {
    return <Navigate to="/styles/new" replace />;
  }
  return <Dashboard />;
}

// function AdminPlaceholder({ titleKey }: { titleKey: string }) {
//   const { t } = useTranslation();
//   return <PlaceholderSection title={t(titleKey)} />;
// }

function App() {
  // App mounted = React committed + the initial route's chunks resolved
  // far enough to render *something* (even just the Suspense fallback).
  // Hiding the splash here — instead of an arbitrary rAF×2 from main.tsx
  // — guarantees the user sees the app, not a blank frame.
  useEffect(() => {
    markChunkLoadSucceeded();
    void hideSplash();
  }, []);

  return (
    <AuthProvider>
      <ToastProvider>
        <AppToaster />
        <Onboarding />
        <BrowserRouter>
          <ErrorBoundary>
          <Routes>
            <Route path="/login" element={<Login />} />

            {/* ERP → SkuCast SSO bridge. Standalone (outside ProtectedRoute)
                like /login — it self-guards, redirecting an unauthenticated
                visitor to /login?next=/sso/skucast and then minting + handing
                off to SkuCast once signed in. One-directional: SkuCast trusts
                the ERP, never the reverse. */}
            <Route path="/sso/skucast" element={<SsoSkucast />} />

            {/* Unified office Home — the single role-aware landing surface.
                Rendered inside the AdminShell chrome (sidebar + header).
                The index decides: office roles see <Home/>; floor roles are
                bounced to their own floor/stage homes by <Dashboard/> (the
                role router), so they never loop on `/`. */}
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <S>
                    <AdminShell />
                  </S>
                </ProtectedRoute>
              }
            >
              <Route
                index
                element={
                  <S>
                    <HomeRoute />
                  </S>
                }
              />
            </Route>

            <Route
              path="/dispatches/:id/print"
              element={
                <ProtectedRoute>
                  <S>
                    <DispatchPrint />
                  </S>
                </ProtectedRoute>
              }
            />

            {/* Full-window Pattern/CAD preview. Linked from the inline
                PatternCadPreview file rows on every Style detail page;
                opens in a new tab via target="_blank". */}
            <Route
              path="/cad/preview"
              element={
                <ProtectedRoute>
                  <S>
                    <CadPreviewPage />
                  </S>
                </ProtectedRoute>
              }
            />

            <Route
              path="/admin"
              element={
                // production_editor + warehouse_manager must be here too: this
                // parent guard runs BEFORE any child's allowedRoles, so a
                // child-only widening (production, inventory-health) never gets
                // reached. warehouse_manager reaches ONLY the production child.
                <ProtectedRoute
                  allowedRoles={[
                    'admin',
                    'viewer',
                    'production_lead',
                    'production_editor',
                    'warehouse_manager',
                    // Reaches ONLY the production board child, to set fabric status.
                    'fabric_manager',
                  ]}
                >
                  <S>
                    <AdminShell />
                  </S>
                </ProtectedRoute>
              }
            >
              {/* AdminHome is retired — `/admin` now redirects to the
                  unified Home at `/`. The Production page (locator),
                  Dispatches, Users, etc. remain reachable as child routes. */}
              <Route index element={<Navigate to="/" replace />} />
              <Route
                path="locator"
                element={
                  // Re-gated: the /admin parent was widened for production_editor,
                  // which must NOT inherit unrelated surfaces.
                  <ProtectedRoute allowedRoles={['admin', 'viewer', 'production_lead']}>
                  <S>
                    <Locator />
                  </S>
                  </ProtectedRoute>
                }
              />
              {/* Production KPI dashboard (Google Sheet). Inherits the /admin
                  parent guard: admin / viewer / production_lead. */}
              <Route
                path="production-kpis"
                element={
                  // Re-gated: the /admin parent was widened for production_editor,
                  // which must NOT inherit unrelated surfaces.
                  <ProtectedRoute allowedRoles={['admin', 'viewer', 'production_lead']}>
                  <S>
                    <ProductionKpis />
                  </S>
                  </ProtectedRoute>
                }
              />
              {/* Sales analytics — the same SalesKpis view, filtered per section
                  (each route mounts its own instance, all hitting the 5-min-cached
                  /sales-kpis). Guarded to admin + viewer (production_lead only sees
                  Production KPIs); the BE re-checks the same roles. */}
              <Route
                path="sales-kpis"
                element={
                  <ProtectedRoute allowedRoles={['admin', 'viewer']}>
                    <S>
                      <SalesKpis
                        buckets={['sales']}
                        titleKey="admin.nav.salesKpis"
                        titleDefault="Sales KPIs"
                        subtitleDefault="Revenue, orders, AOV/ASP & returns — all warehouses."
                      />
                    </S>
                  </ProtectedRoute>
                }
              />
              <Route
                path="analytics/inventory-health"
                element={
                  <ProtectedRoute allowedRoles={[...PRODUCTION_READ_ROLES]}>
                    <S>
                      <InventoryHealth />
                    </S>
                  </ProtectedRoute>
                }
              />
              <Route
                path="production"
                element={
                  <ProtectedRoute allowedRoles={[...PRODUCTION_BOARD_READ_ROLES]}>
                    <S>
                      <Production />
                    </S>
                  </ProtectedRoute>
                }
              />
              {/* One lot's journey. Same guard as the board it opens from. */}
              <Route
                path="production/lots/:id"
                element={
                  <ProtectedRoute allowedRoles={[...PRODUCTION_BOARD_READ_ROLES]}>
                    <S>
                      <ProductionLotDetail />
                    </S>
                  </ProtectedRoute>
                }
              />
              <Route
                path="analytics/fulfilment"
                element={
                  <ProtectedRoute allowedRoles={['admin', 'viewer']}>
                    <S>
                      <SalesKpis
                        buckets={['fulfilment']}
                        titleKey="admin.nav.analyticsFulfilment"
                        titleDefault="Fulfilment"
                        subtitleDefault="Dispatch volume, TAT & SLA."
                      />
                    </S>
                  </ProtectedRoute>
                }
              />
              <Route
                path="locator/sku/:sku"
                element={
                  // Re-gated: the /admin parent was widened for production_editor,
                  // which must NOT inherit unrelated surfaces.
                  <ProtectedRoute allowedRoles={['admin', 'viewer', 'production_lead']}>
                  <S>
                    <SkuDetail />
                  </S>
                  </ProtectedRoute>
                }
              />
              <Route
                path="dispatches"
                element={
                  // Floor ledger (admin/viewer/production_lead) + Production
                  // challans tab (adds production_editor + warehouse_manager).
                  <ProtectedRoute allowedRoles={[...DISPATCH_VIEW_ROLES]}>
                  <S>
                    <Dispatches />
                  </S>
                  </ProtectedRoute>
                }
              />
              <Route
                path="dispatches/:id"
                element={
                  // Re-gated: the /admin parent was widened for production_editor,
                  // which must NOT inherit unrelated surfaces.
                  <ProtectedRoute allowedRoles={['admin', 'viewer', 'production_lead']}>
                  <S>
                    <DispatchDetail />
                  </S>
                  </ProtectedRoute>
                }
              />
              <Route
                path="users"
                element={
                  // User management is admin/viewer only (matches BE
                  // GET /users) — the /admin parent now admits production_lead
                  // for Production + Dispatches, so re-gate to keep it out of
                  // Users.
                  <ProtectedRoute allowedRoles={['admin', 'viewer']}>
                    <S>
                      <UsersPage />
                    </S>
                  </ProtectedRoute>
                }
              />
              <Route
                path="warehouses"
                element={
                  // Re-gated: the /admin parent was widened for production_editor,
                  // which must NOT inherit unrelated surfaces.
                  <ProtectedRoute allowedRoles={['admin', 'viewer', 'production_lead']}>
                  <S>
                    <Warehouses />
                  </S>
                  </ProtectedRoute>
                }
              />
              <Route
                path="edit-requests"
                element={
                  // The lot edit-request approval queue is admin-only: BE gates
                  // GET /lots/edit-requests to admin and the sidebar only shows
                  // it to admin, so match that here (the /admin parent now also
                  // admits production_lead + viewer).
                  <ProtectedRoute allowedRoles={['admin']}>
                    <S>
                      <EditRequestsPage />
                    </S>
                  </ProtectedRoute>
                }
              />
              {/* TODO: build — admin Vendors, SKUs and Settings pages.
                  Routes intentionally hidden so the menu doesn't surface stubs.
                  Master-data CRUD lives under /data for the production_lead role.
              <Route
                path="vendors"
                element={<AdminPlaceholder titleKey="admin.placeholder.vendors" />}
              />
              <Route
                path="skus"
                element={<AdminPlaceholder titleKey="admin.placeholder.skus" />}
              />
              <Route
                path="settings"
                element={<AdminPlaceholder titleKey="admin.placeholder.settings" />}
              />
              */}
            </Route>

            {/* Floor manager — receiving + assignment + 24h edit window. */}
            <Route
              path="/floor"
              element={
                <ProtectedRoute allowedRoles={['floor_manager', 'admin', 'production_lead']}>
                  <S>
                    <FloorHome />
                  </S>
                </ProtectedRoute>
              }
            />
            <Route
              path="/floor/receive"
              element={
                <ProtectedRoute allowedRoles={['floor_manager', 'admin', 'production_lead']}>
                  <S>
                    <ReceiveFromKotty />
                  </S>
                </ProtectedRoute>
              }
            />
            <Route
              path="/floor/lot/:lotId"
              element={
                <ProtectedRoute allowedRoles={['floor_manager', 'admin', 'production_lead']}>
                  <S>
                    <FloorLotDetail />
                  </S>
                </ProtectedRoute>
              }
            />
            <Route
              path="/floor/lot/:lotId/edit"
              element={
                <ProtectedRoute allowedRoles={['floor_manager', 'admin', 'production_lead']}>
                  <S>
                    <FloorEditLot />
                  </S>
                </ProtectedRoute>
              }
            />

            <Route
              path="/stitching"
              element={
                <ProtectedRoute allowedRoles={['stitching_master', 'admin', 'viewer', 'production_lead']}>
                  <S>
                    <StitchingHome />
                  </S>
                </ProtectedRoute>
              }
            />
            {/* Legacy alias — floor manager owns receive now. Admin
                + floor_manager + production_lead keep access; stitching_master is blocked. */}
            <Route
              path="/stitching/receive"
              element={
                <ProtectedRoute allowedRoles={['floor_manager', 'admin', 'production_lead']}>
                  <S>
                    <ReceiveFromKotty />
                  </S>
                </ProtectedRoute>
              }
            />
            <Route
              path="/stitching/lot/:lotId"
              element={
                <ProtectedRoute allowedRoles={['stitching_master', 'admin', 'production_lead']}>
                  <S>
                    <StitchingReceiveLot />
                  </S>
                </ProtectedRoute>
              }
            />
            <Route
              path="/stitching/worked-on/:lotId"
              element={
                <ProtectedRoute allowedRoles={['stitching_master', 'admin', 'viewer', 'production_lead']}>
                  <S>
                    <StitchingWorkedOnDetail />
                  </S>
                </ProtectedRoute>
              }
            />
            <Route
              path="/finishing"
              element={
                <ProtectedRoute allowedRoles={['finishing_master', 'admin', 'viewer', 'production_lead']}>
                  <S>
                    <FinishingHome />
                  </S>
                </ProtectedRoute>
              }
            />
            <Route
              path="/finishing/lot/:lotId"
              element={
                <ProtectedRoute allowedRoles={['finishing_master', 'admin', 'production_lead']}>
                  <S>
                    <FinishingReceiveLot />
                  </S>
                </ProtectedRoute>
              }
            />
            <Route
              path="/finishing/worked-on/:lotId"
              element={
                <ProtectedRoute allowedRoles={['finishing_master', 'admin', 'viewer', 'production_lead']}>
                  <S>
                    <FinishingWorkedOnDetail />
                  </S>
                </ProtectedRoute>
              }
            />
            <Route
              path="/data"
              element={
                <ProtectedRoute allowedRoles={['admin', 'viewer', 'production_lead']}>
                  <S>
                    <AdminShell />
                  </S>
                </ProtectedRoute>
              }
            >
              <Route
                index
                element={
                  <S>
                    <DataHome />
                  </S>
                }
              />
            </Route>

            {/* Product Development module — Styles + Fabric Library.
                Gating mirrors the BE styles WRITE set + viewer for read.
                BE role guard still enforces the finer-grained checks. */}
            <Route
              path="/styles"
              element={
                <ProtectedRoute
                  allowedRoles={[
                    'admin',
                    'sampling_editor',
                    'sampling_lead',
                    'viewer',
                    // Production admin reaches the registry from the Home cards.
                    'production_lead',
                    // Go-to-market role: reaches the registry, the workspace
                    // (EasyEcom checkpoint + channels), and the intake form.
                    'cataloguer',
                    // Submit-only role lands on /styles/new (this parent gates
                    // it) and reads back its created style on /styles/:id.
                    'design_submitter',
                  ]}
                >
                  <S>
                    <AdminShell />
                  </S>
                </ProtectedRoute>
              }
            >
              {/* Old Sampling registry list is RETIRED — the Dashboard
                  ("Sampling") is the single sampling surface. The index bounces
                  to it so /styles is unreachable by nav OR direct URL, while the
                  workspace (/styles/:id) + intake (/styles/new) below stay live
                  (the dashboard drill-down + "Submit design" still use them). */}
              <Route index element={<Navigate to="/" replace />} />
              <Route
                path="new"
                element={
                  // Intake creates a Style (write). The /styles parent now
                  // admits read-only office roles for the registry
                  // drill-down, so re-gate the create form to the design-create
                  // set (DESIGN_SUBMIT_ROLES = PD writers + cataloguer +
                  // design_submitter, mirrors the BE styles CREATE and the Home
                  // "+ Submit design" CTA) — otherwise a read-only role could
                  // open the form by URL and only hit the 403 on submit.
                  <ProtectedRoute allowedRoles={[...DESIGN_SUBMIT_ROLES]}>
                    <S>
                      <NewIntake />
                    </S>
                  </ProtectedRoute>
                }
              />
              <Route
                path=":styleId"
                element={
                  <S>
                    <StyleWorkspace />
                  </S>
                }
              />
            </Route>

            {/* China Import — its own first-class destination, a simple
                flat registry for NW- prefixed imported styles. */}
            <Route
              path="/china-import"
              element={
                <ProtectedRoute
                  allowedRoles={[
                    'admin',
                    'sampling_editor',
                    'sampling_lead',
                    'production_lead',
                  ]}
                >
                  <S>
                    <AdminShell />
                  </S>
                </ProtectedRoute>
              }
            >
              <Route
                index
                element={
                  <S>
                    <ChinaImportRegistry />
                  </S>
                }
              />
            </Route>

            <Route
              path="/fabric-library"
              element={
                <ProtectedRoute
                  allowedRoles={[
                    'admin',
                    'sampling_editor',
                    'sampling_lead',
                    'viewer',
                    'production_lead',
                    'fabric_manager',
                  ]}
                >
                  <S>
                    <AdminShell />
                  </S>
                </ProtectedRoute>
              }
            >
              <Route
                index
                element={
                  <S>
                    <FabricLibrary />
                  </S>
                }
              />
              <Route
                path="receive"
                element={
                  <S>
                    <ReceiveFabricChallan />
                  </S>
                }
              />
            </Route>

            <Route path="/dashboard" element={<Navigate to="/" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </ErrorBoundary>
        </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  );
}

export default App;
