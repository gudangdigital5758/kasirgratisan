import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { lazy, Suspense, useEffect } from "react";
import { checkVersion } from "@/lib/version-check";
import { initAnalytics } from "@/lib/analytics";
import { captureAffiliateRef } from "@/lib/affiliate";
import { Capacitor } from "@capacitor/core";
import { StatusBar } from "@capacitor/status-bar";
import { useAppUpdate } from "@/hooks/use-app-update";
import { AuthProvider } from "@/hooks/use-auth";
import { GoogleOAuthProvider } from "@react-oauth/google";
import { CloudAuthProvider } from "@/hooks/use-cloud-auth";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import AnalyticsTracker from "@/components/AnalyticsTracker";
import PageLoader from "@/components/PageLoader";
import { I18nextProvider } from "react-i18next";
import i18n from "./i18n";
import AppLayout from "./components/layout/AppLayout";
import { BRAND } from "@/lib/brand";
import { CLOUD_ROUTES, CLOUD_LEGACY_REDIRECTS } from "./lib/cloud-routes";

// Route-level code splitting: tiap halaman diunduh & di-parse on-demand.
// (Di PWA, Workbox tetap pre-cache semua chunk; manfaat utama = parse/execute
//  awal lebih ringan + cache per-route.)
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Cashier = lazy(() => import("./pages/Cashier"));
const Products = lazy(() => import("./pages/Products"));
const Reports = lazy(() => import("./pages/Reports"));
const Settings = lazy(() => import("./pages/Settings"));
const SupplierPage = lazy(() => import("./pages/Supplier"));
const CustomersPage = lazy(() => import("./pages/Customers"));
const StockInPage = lazy(() => import("./pages/StockIn"));
const StockOutPage = lazy(() => import("./pages/StockOut"));
const TransactionHistory = lazy(() => import("./pages/TransactionHistory"));
const StockReport = lazy(() => import("./pages/StockReport"));
const UsersPage = lazy(() => import("./pages/Users"));
const ExpensesPage = lazy(() => import("./pages/Expenses"));
const DebtsPage = lazy(() => import("./pages/Debts"));
const ShiftsPage = lazy(() => import("./pages/Shifts"));
const PaymentMethodsSettings = lazy(() => import("./pages/settings/PaymentMethodsSettings"));
const ProductCategoriesSettings = lazy(() => import("./pages/settings/ProductCategoriesSettings"));
const ExpenseCategoriesSettings = lazy(() => import("./pages/settings/ExpenseCategoriesSettings"));
const UnitsSettings = lazy(() => import("./pages/settings/UnitsSettings"));
const ThemeSettings = lazy(() => import("./pages/settings/ThemeSettings"));
const ReceiptSettings = lazy(() => import("./pages/settings/ReceiptSettings"));
const IssueReport = lazy(() => import("./pages/settings/IssueReport"));
const StockOpname = lazy(() => import("./pages/settings/StockOpname"));
const RoleManager = lazy(() => import("./pages/settings/RoleManager"));
const StoresManager = lazy(() => import("./pages/settings/StoresManager"));
const BackupRestoreSettings = lazy(() => import("./pages/settings/BackupRestoreSettings"));
const CloudHub = lazy(() => import("./pages/settings/CloudHub"));
const JoinPage = lazy(() => import("./pages/JoinPage"));
const CloudHistorySettings = lazy(() => import("./pages/settings/CloudHistorySettings"));
const CloudBackupsListSettings = lazy(() => import("./pages/settings/CloudBackupsListSettings"));
const CloudStoreSettings = lazy(() => import("./pages/settings/CloudStoreSettings"));
const CloudOnlineStoreSettings = lazy(() => import("./pages/settings/CloudOnlineStoreSettings"));
const NotFound = lazy(() => import("./pages/NotFound"));

/**
 * Redirect kompatibel untuk link referral lama/baru:
 *   /?ref=KODE → /join?ref=KODE
 * Di bundle terbaru funnel join tampil; di PWA/bundle lama route /join tidak
 * dikenal sehingga root lama tetap aman (200, referral tercapture).
 * Tanpa ?ref → render Dashboard normal.
 */
function RootOrReferral() {
  const location = useLocation();
  const code = new URLSearchParams(location.search).get("ref")?.trim().toUpperCase() || "";
  if (code) return <Navigate to={`/join?ref=${encodeURIComponent(code)}`} replace />;
  return <Dashboard />;
}

/** Route legacy: dashboard affiliate pindah penuh ke portal affiliate.profitku.my.id/dashboard. */
function AffiliateRedirect() {
  useEffect(() => {
    window.location.replace(`${BRAND.affiliateOrigin}/dashboard`);
  }, []);
  return null;
}

/** Preserve query/hash when redirecting legacy cloud-backup URLs. */
function LegacyCloudRedirect({ to }: { to: string }) {
  const location = useLocation();
  return <Navigate to={`${to}${location.search}${location.hash}`} replace />;
}

const queryClient = new QueryClient();
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "";

const App = () => {
  // Aktifkan pengecekan & unduhan update otomatis untuk Android
  useAppUpdate();

  useEffect(() => {
    checkVersion();
    initAnalytics();
    // Tangkap jalur affiliasi dari URL (?ref=KODE) sekali saat start (best-effort).
    void captureAffiliateRef();

    if (Capacitor.isNativePlatform()) {
      StatusBar.setOverlaysWebView({ overlay: false }).catch(err => {
        console.warn("Gagal mengatur StatusBar overlay:", err);
      });
      document.documentElement.classList.add('is-native');
    }

  }, []);

  return (
    <I18nextProvider i18n={i18n}>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <Toaster />
            <Sonner />
            <BrowserRouter>
              <AuthProvider>
               <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
                <CloudAuthProvider>
                <AnalyticsTracker />
              <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route
                  path="/join"
                  element={
                    <ErrorBoundary>
                      <JoinPage />
                    </ErrorBoundary>
                  }
                />
                <Route element={<AppLayout />}>
                  <Route
                    path="/"
                    element={
                      <ErrorBoundary>
                        <RootOrReferral />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/cashier"
                    element={
                      <ErrorBoundary>
                        <Cashier />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/products"
                    element={
                      <ErrorBoundary>
                        <Products />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/reports"
                    element={
                      <ErrorBoundary>
                        <Reports />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/settings"
                    element={
                      <ErrorBoundary>
                        <Settings />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/supplier"
                    element={
                      <ErrorBoundary>
                        <SupplierPage />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/customers"
                    element={
                      <ErrorBoundary>
                        <CustomersPage />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/stock-in"
                    element={
                      <ErrorBoundary>
                        <StockInPage />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/stock-out"
                    element={
                      <ErrorBoundary>
                        <StockOutPage />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/history"
                    element={
                      <ErrorBoundary>
                        <TransactionHistory />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/stock-report"
                    element={
                      <ErrorBoundary>
                        <StockReport />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/users"
                    element={
                      <ErrorBoundary>
                        <UsersPage />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/expenses"
                    element={
                      <ErrorBoundary>
                        <ExpensesPage />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/debts"
                    element={
                      <ErrorBoundary>
                        <DebtsPage />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/shifts"
                    element={
                      <ErrorBoundary>
                        <ShiftsPage />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/settings/payment-methods"
                    element={
                      <ErrorBoundary>
                        <PaymentMethodsSettings />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/settings/product-category"
                    element={
                      <ErrorBoundary>
                        <ProductCategoriesSettings />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/settings/expense-category"
                    element={
                      <ErrorBoundary>
                        <ExpenseCategoriesSettings />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/settings/units"
                    element={
                      <ErrorBoundary>
                        <UnitsSettings />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/settings/theme"
                    element={
                      <ErrorBoundary>
                        <ThemeSettings />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/settings/receipt"
                    element={
                      <ErrorBoundary>
                        <ReceiptSettings />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/settings/report-issue"
                    element={
                      <ErrorBoundary>
                        <IssueReport />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/settings/roles"
                    element={
                      <ErrorBoundary>
                        <RoleManager />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/settings/stores"
                    element={
                      <ErrorBoundary>
                        <StoresManager />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/settings/stock-opname"
                    element={
                      <ErrorBoundary>
                        <StockOpname />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/settings/backup"
                    element={
                      <ErrorBoundary>
                        <BackupRestoreSettings />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path={CLOUD_ROUTES.hub}
                    element={
                      <ErrorBoundary>
                        <CloudHub />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path={CLOUD_ROUTES.history}
                    element={
                      <ErrorBoundary>
                        <CloudHistorySettings />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path={CLOUD_ROUTES.files}
                    element={
                      <ErrorBoundary>
                        <CloudBackupsListSettings />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path={CLOUD_ROUTES.stores}
                    element={
                      <ErrorBoundary>
                        <CloudStoreSettings />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path={CLOUD_ROUTES.onlineStore}
                    element={
                      <ErrorBoundary>
                        <CloudOnlineStoreSettings />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/affiliate"
                    element={
                      <ErrorBoundary>
                        <AffiliateRedirect />
                      </ErrorBoundary>
                    }
                  />
                  {CLOUD_LEGACY_REDIRECTS.map(({ from, to }) => (
                    <Route key={from} path={from} element={<LegacyCloudRedirect to={to} />} />
                  ))}
                </Route>
                <Route path="*" element={<NotFound />} />
              </Routes>
              </Suspense>
              </CloudAuthProvider>
             </GoogleOAuthProvider>
            </AuthProvider>
          </BrowserRouter>
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
    </I18nextProvider>
  );
};

export default App;
