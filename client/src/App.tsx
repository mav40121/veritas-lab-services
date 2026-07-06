import { Switch, Route, Router, useLocation, Redirect } from "wouter";
const VeritaCheckVerificationPage = lazy(() => import("@/pages/VeritaCheckVerificationPage"));
const ArticleInventoryManagementPage = lazy(() => import("@/pages/ArticleInventoryManagementPage"));
import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, lazy, Suspense } from "react";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AuthProvider, useAuth } from "@/components/AuthContext";
import { LegacyWorkspaceRedirect } from "@/components/LegacyWorkspaceRedirect";
import { NavBar } from "@/components/NavBar";
import { SubscriptionBanner } from "@/components/SubscriptionBanner";
import { SubscriptionModal } from "@/components/SubscriptionModal";
import { OnboardingWizard } from "@/components/OnboardingWizard";
import { ChevronUp } from "lucide-react";
import HomePage from "@/pages/HomePage";
import { isStockHost } from "@/lib/host";
const ServicesPage = lazy(() => import("@/pages/ServicesPage"));
const BookScopingCallPage = lazy(() => import("@/pages/BookScopingCallPage"));
const AdminSchedulingPage = lazy(() => import("@/pages/AdminSchedulingPage"));
const TeamPage = lazy(() => import("@/pages/TeamPage"));
const VeritaCheckPage = lazy(() => import("@/pages/VeritaCheckPage"));
const StudyResultsPage = lazy(() => import("@/pages/StudyResultsPage"));
const DashboardPage = lazy(() => import("@/pages/DashboardPage"));
const VeritaCheckSignoffGroupsPage = lazy(() => import("@/pages/VeritaCheckSignoffGroupsPage"));
const VeritaCheckCoveragePage = lazy(() => import("@/pages/VeritaCheckCoveragePage"));
const ContactPage = lazy(() => import("@/pages/ContactPage"));
const LoginPage = lazy(() => import("@/pages/LoginPage"));
const NotFound = lazy(() => import("@/pages/not-found"));
const TermsPage = lazy(() => import("@/pages/TermsPage"));
const PrivacyPage = lazy(() => import("@/pages/PrivacyPage"));
const TrustPage = lazy(() => import("@/pages/TrustPage"));
const ResetPasswordPage = lazy(() => import("@/pages/ResetPasswordPage"));
const StudyGuidePage = lazy(() => import("@/pages/StudyGuidePage"));
const BookPage = lazy(() => import("@/pages/BookPage"));
const VeritaScanPage = lazy(() => import("@/pages/VeritaScanPage"));
const VeritaMapPage = lazy(() => import("@/pages/VeritaMapPage"));
const DemoLabPage = lazy(() => import("@/pages/DemoLabPage"));
const DemoPage = lazy(() => import("@/pages/DemoPage"));
const DemoSelectorPage = lazy(() => import("@/pages/DemoSelectorPage"));
const DemoCprtPage = lazy(() => import("@/pages/DemoCprtPage"));
const DemoQcPage = lazy(() => import("@/pages/DemoQcPage"));
const ResourcesPage = lazy(() => import("@/pages/ResourcesPage"));
const ArticlePrecisionInterpretationPage = lazy(() => import("@/pages/ArticlePrecisionInterpretationPage"));
const ArticleReferenceIntervalVerificationPage = lazy(() => import("@/pages/ArticleReferenceIntervalVerificationPage"));
const ArticleQCTestingIntoCompliancePage = lazy(() => import("@/pages/ArticleQCTestingIntoCompliancePage"));
const ArticleCostPerReportablePage = lazy(() => import("@/pages/ArticleCostPerReportablePage"));
const ArticleWhyVeritaCheckPage = lazy(() => import("@/pages/ArticleWhyVeritaCheckPage"));
const FAQPage = lazy(() => import("@/pages/FAQPage"));
const PricingPage = lazy(() => import("@/pages/PricingPage"));
const ArticleCalVerPage = lazy(() => import("@/pages/ArticleCalVerPage"));
const ArticleEP26Page = lazy(() => import("@/pages/ArticleEP26Page"));
const ArticleTeaPage = lazy(() => import("@/pages/ArticleTeaPage"));
const ArticleTrainingPage = lazy(() => import("@/pages/ArticleTrainingPage"));
const ArticleCLIACalVerRequirementsPage = lazy(() => import("@/pages/ArticleCLIACalVerRequirementsPage"));
const ArticleMethodComparisonPage = lazy(() => import("@/pages/ArticleMethodComparisonPage"));
const ArticleTJCInspectionPage = lazy(() => import("@/pages/ArticleTJCInspectionPage"));
const ArticleValidateVeritaCheckPage = lazy(() => import("@/pages/ArticleValidateVeritaCheckPage"));
const ArticleManualLogsPage = lazy(() => import("@/pages/ArticleManualLogsPage"));
const TeaLookupPage = lazy(() => import("@/pages/TeaLookupPage"));
const VeritaScanAppPage = lazy(() => import("@/pages/VeritaScanAppPage"));
const VeritaScanScanPage = lazy(() => import("@/pages/VeritaScanScanPage"));
const VeritaScanDocumentLibraryPage = lazy(() => import("@/pages/VeritaScanDocumentLibraryPage"));
const VeritaScanInspectionProofPage = lazy(() => import("@/pages/VeritaScanInspectionProofPage"));
const VeritaMapAppPage = lazy(() => import("@/pages/VeritaMapAppPage"));
const VeritaMapBuildPage = lazy(() => import("@/pages/VeritaMapBuildPage"));
const VeritaMapMapPage = lazy(() => import("@/pages/VeritaMapMapPage"));
const VeritaMapResourcesPage = lazy(() => import("@/pages/VeritaMapResourcesPage"));
const VeritaMapLabwidePage = lazy(() => import("@/pages/VeritaMapLabwidePage"));
const VeritaTrackAppPage = lazy(() => import("@/pages/VeritaTrackAppPage"));
const VeritaTrackPage = lazy(() => import("@/pages/VeritaTrackPage"));
const VeritaCompPage = lazy(() => import("@/pages/VeritaCompPage"));
const VeritaCompAppPage = lazy(() => import("@/pages/VeritaCompAppPage"));
const VeritaPTPage = lazy(() => import("@/pages/VeritaPTPage"));
const VeritaPTAppPage = lazy(() => import("@/pages/VeritaPTAppPage"));
const VeritaResponseAppPage = lazy(() => import("@/pages/VeritaResponseAppPage"));
const VeritaResponseFindingPage = lazy(() => import("@/pages/VeritaResponseFindingPage"));
const VeritaStaffPage = lazy(() => import("@/pages/VeritaStaffPage"));
const VeritaStaffAppPage = lazy(() => import("@/pages/VeritaStaffAppPage"));
const VeritaLabPage = lazy(() => import("@/pages/VeritaLabPage"));
const VeritaLabAppPage = lazy(() => import("@/pages/VeritaLabAppPage"));
const VeritaQCAppPage = lazy(() => import("@/pages/VeritaQCAppPage"));
const VeritaQCDailyReviewPage = lazy(() => import("@/pages/VeritaQCDailyReviewPage"));
const VeritaPolicyAppPage = lazy(() => import("@/pages/VeritaPolicyAppPage"));
const VeritaPolicyMyPoliciesPage = lazy(() => import("@/pages/VeritaPolicyMyPoliciesPage"));
const VeritaPolicyCompliancePage = lazy(() => import("@/pages/VeritaPolicyCompliancePage"));
const SurveyorViewPage = lazy(() => import("@/pages/SurveyorViewPage"));
const VeritaPolicyPage = lazy(() => import("@/pages/VeritaPolicyPage"));
const CumsumPage = lazy(() => import("@/pages/CumsumPage"));
const RoadmapPage = lazy(() => import("@/pages/RoadmapPage"));
const GettingStartedPage = lazy(() => import("@/pages/GettingStartedPage"));
const AccountSettingsPage = lazy(() => import("@/pages/AccountSettingsPage"));
const VeritaAssurePage = lazy(() => import("@/pages/VeritaAssurePage"));
const OperationsPage = lazy(() => import("@/pages/OperationsPage"));
const AdminReportPage = lazy(() => import("@/pages/AdminReportPage"));
const JoinPage = lazy(() => import("@/pages/JoinPage"));
const ProductivityCalculatorPage = lazy(() => import("@/pages/ProductivityCalculatorPage"));
const VeritaBenchPage = lazy(() => import("@/pages/VeritaBenchPage"));
const VeritaBenchStaffingPage = lazy(() => import("@/pages/VeritaBenchStaffingPage"));
const VeritaStockPage = lazy(() => import("@/pages/VeritaStockPage"));
const VeritaStockTrendsPage = lazy(() => import("@/pages/VeritaStockTrendsPage"));
const VeritaStockVendorsPage = lazy(() => import("@/pages/VeritaStockVendorsPage"));
const VeritaStockSnapOrderPage = lazy(() => import("@/pages/VeritaStockSnapOrderPage"));
const VeritaStockReceivingPage = lazy(() => import("@/pages/VeritaStockReceivingPage"));
const VeritaStockAuditTrailPage = lazy(() => import("@/pages/VeritaStockAuditTrailPage"));
const VeritaStockEnterprisePage = lazy(() => import("@/pages/VeritaStockEnterprisePage"));
const VeritaStockLandingPage = lazy(() => import("@/pages/VeritaStockLandingPage"));
const HospitalInventoryPage = lazy(() => import("@/pages/HospitalInventoryPage"));
const VeritaOpsAppPage = lazy(() => import("@/pages/VeritaOpsAppPage"));
const LabMembersPage = lazy(() => import("@/pages/LabMembersPage"));
const FoundingLabApplyPage = lazy(() => import("@/pages/FoundingLabApplyPage"));
const StaffPortalPage = lazy(() => import("@/pages/StaffPortalPage"));
const VeritaBenchPIPage = lazy(() => import("@/pages/VeritaBenchPIPage"));
const RequestInvoicePage = lazy(() => import("@/pages/RequestInvoicePage"));
import { OnboardingBanner } from "@/components/OnboardingBanner";

function BackToTop() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const handleScroll = () => setVisible(window.scrollY > 400);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);
  if (!visible) return null;
  return (
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      className="fixed bottom-6 right-6 z-50 bg-teal-600 text-white rounded-full p-3 shadow-lg hover:bg-teal-700 transition-all"
      aria-label="Back to top"
    >
      <ChevronUp className="h-5 w-5" />
    </button>
  );
}

function SiteFooter() {
  // On the veritastock.com host, render a minimal VeritaStock footer instead of
  // the lab-services footer (company tagline, lab module links, the book, CLIA
  // links) so the inventory front door stays free of lab-compliance chrome.
  if (isStockHost()) {
    return (
      <footer className="border-t border-border bg-card">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 flex flex-col sm:flex-row justify-between items-center gap-3">
          <p className="text-xs text-muted-foreground">© 2026 Veritas Lab Services, LLC · VeritaStock™ Multi-Location Inventory</p>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <a href="mailto:info@veritaslabservices.com" className="hover:text-primary transition-colors">info@veritaslabservices.com</a>
            <a href="/terms" className="hover:text-primary transition-colors">Terms</a>
            <a href="/privacy" className="hover:text-primary transition-colors">Privacy</a>
          </div>
        </div>
      </footer>
    );
  }
  return (
    <footer className="border-t border-border bg-card">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
        <div className="grid sm:grid-cols-3 gap-8 mb-8">
          <div>
            <div className="font-serif font-bold text-base mb-2">Veritas Lab Services, LLC</div>
            <p className="text-sm text-muted-foreground leading-relaxed">Expert clinical laboratory consulting: leadership coaching, regulatory readiness, productivity analysis, and VeritaCheck™ study analysis.</p>
          </div>
          <div>
            <div className="font-semibold text-sm mb-3">Services</div>
            <ul className="space-y-1.5 text-sm text-muted-foreground">
              {["Leadership Coaching","Inspection Readiness","Productivity Analysis","Regulatory Preparedness","VeritaCheck™ Study Analysis"].map(s => <li key={s}>{s}</li>)}
            </ul>
          </div>
          <div>
            <div className="font-semibold text-sm mb-3">Contact</div>
            <p className="text-sm text-muted-foreground">info@veritaslabservices.com</p>
            <p className="text-sm text-muted-foreground mt-1">We respond to emails promptly.</p>
            <div className="mt-3">
              <div className="font-semibold text-sm mb-2">Resources</div>
              <ul className="space-y-1 text-sm text-muted-foreground">
                <li><a href="/resources" className="hover:text-primary transition-colors">Resources: Clinical Lab Knowledge Base</a></li>
                <li><a href="/veritamap" className="hover:text-primary transition-colors">VeritaMap™: Test Menu Regulatory Mapping</a></li>
                <li><a href="/veritascan" className="hover:text-primary transition-colors">VeritaScan™: Compliance Audit Tool</a></li>
                <li><a href="/veritacomp" className="hover:text-primary transition-colors">VeritaComp™: Competency Management</a></li>
                <li><a href="/veritastaff" className="hover:text-primary transition-colors">VeritaStaff™: Personnel Management</a></li>
                <li><a href="/veritalab" className="hover:text-primary transition-colors">VeritaLab™: Certificate Tracking</a></li>
                <li><a href="/veritapolicy" className="hover:text-primary transition-colors">VeritaPolicy™: Standards Compliance Tracker</a></li>
                <li><a href="/book" className="hover:text-primary transition-colors">Lab Management 101: New Book</a></li>
                <li><a href="/study-guide" className="hover:text-primary transition-colors">Study Guide: Which study do I need?</a></li>
                <li><a href="https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493" target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">CLIA Regulations (eCFR)</a></li>
                <li><a href="https://www.cms.gov/medicare/quality/clinical-laboratory-improvement-amendments/brochures" target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">CLIA Brochures (CMS)</a></li>
                <li><a href="https://www.medlabmag.com" target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">Medical Lab Management</a></li>
              </ul>
            </div>
          </div>
        </div>
        {/* Disclaimer */}
        <div className="border-t border-border pt-4 mb-4">
          <p className="text-xs text-muted-foreground leading-relaxed">
            <strong>Disclaimer:</strong> VeritaCheck™ is a statistical analysis tool intended for use by qualified laboratory professionals.
            Results require interpretation by a licensed medical director or designee and do not constitute medical advice, diagnosis, or treatment.
            Veritas Lab Services, LLC assumes no liability for clinical decisions made based on VeritaCheck™ output.
            By using this tool you agree to our{" "}
            <a href="/terms" className="text-primary hover:underline">Terms of Service</a>{" "}and{" "}
            <a href="/privacy" className="text-primary hover:underline">Privacy Policy</a>.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row justify-between items-center gap-3">
          <p className="text-xs text-muted-foreground">© 2026 Veritas Lab Services, LLC. All Rights Reserved</p>
          <a href="/trust" className="text-xs text-muted-foreground hover:text-primary transition-colors">Trust & Security</a>
        </div>
      </div>
    </footer>
  );
}

// Scrolls to top on every route change
function ScrollToTop() {
  const [location] = useLocation();
  useEffect(() => {
    const t = setTimeout(() => window.scrollTo({ top: 0, behavior: "instant" }), 0);
    return () => clearTimeout(t);
  }, [location]);
  return null;
}

// Updates <link rel="canonical"> on every route change so Google sees
// the correct canonical URL for each page, not just the homepage.
function CanonicalUpdater() {
  const [location] = useLocation();

  useEffect(() => {
    const base = 'https://www.veritaslabservices.com';
    // Strip query params from canonical (search params are not canonical)
    const path = location.split('?')[0];
    const canonical = base + (path === '/' ? '' : path);
    let tag = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    if (!tag) {
      tag = document.createElement('link');
      tag.rel = 'canonical';
      document.head.appendChild(tag);
    }
    tag.href = canonical;
  }, [location]);

  return null;
}

// Fires a GA4 page_view on every route change (including initial load,
// since gtag config uses send_page_view:false to avoid double-counting)
function GATracker() {
  const [location] = useLocation();

  useEffect(() => {
    if (typeof window.gtag === 'function') {
      window.gtag('event', 'page_view', {
        page_path: location,
        page_title: document.title,
      });
    }
  }, [location]);

  return null;
}

function OnboardingGuard() {
  const { user, isLoggedIn } = useAuth();
  const [showWizard, setShowWizard] = useState(false);

  useEffect(() => {
    if (!isLoggedIn || !user) { setShowWizard(false); return; }
    // Check localStorage first - if permanently dismissed for this user, never show again
    const lsKey = `onboarding_dismissed_${user.id}`;
    const locallyDismissed = localStorage.getItem(lsKey) === "1";
    const serverCompleted = (user as any).hasCompletedOnboarding !== false;
    const isSeatUser = (user as any).isSeatUser === true;
    if (locallyDismissed || serverCompleted || isSeatUser) {
      setShowWizard(false);
    } else {
      setShowWizard(true);
    }
  }, [isLoggedIn, user]);

  if (!showWizard || !user) return null;

  const handleComplete = () => {
    localStorage.setItem(`onboarding_dismissed_${user.id}`, "1");
    setShowWizard(false);
  };

  return <OnboardingWizard onComplete={handleComplete} />;
}

function PageFallback() {
  return (
    <div className="flex items-center justify-center py-24" role="status" aria-label="Loading">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
    </div>
  );
}

function AppContent() {
  const [location, setLocation] = useLocation();

  // VeritaStock is a VeritaStock-ONLY product. On the dedicated VeritaStock
  // deployment (VITE_STOCK_DEPLOYMENT=true, or the veritastock.com host), redirect
  // every VeritaAssure marketing/module route to the VeritaStock landing so the
  // service never shows the lab-compliance site on any URL. The lab deployment
  // (veritaslabservices.com) has isStockHost()=false, so it is fully unaffected.
  useEffect(() => {
    if (!isStockHost()) return;
    const p = location;
    const allowed =
      p === "/" ||
      p.startsWith("/login") || p.startsWith("/reset-password") || p.startsWith("/join") ||
      p.startsWith("/inventory") || p.startsWith("/account") || p.startsWith("/veritastock") ||
      /^\/labs\/\d+\/(veritastock|members|account)/.test(p);
    if (!allowed) setLocation("/");
  }, [location, setLocation]);

  // Standalone admin page: no NavBar, no footer, no subscription banners
  if (location === "/admin") {
    return <Suspense fallback={<PageFallback />}><AdminReportPage /></Suspense>;
  }

  // Phase 2c: wraps a legacy workspace page component so unauthenticated /
  // single-lab / no-lab cases pass through untouched, while logged-in users
  // with at least one membership get client-side redirected to the
  // lab-scoped form. See client/src/components/LegacyWorkspaceRedirect.tsx.
  //
  // 2026-06-08: appPath override. Compliance modules whose marketing
  // route shape differs from their app route shape (e.g. /veritascan
  // marketing vs. /labs/:id/veritascan-app app) pass appPath so the
  // redirect lands on the actual app route, not a 404. Routes whose
  // marketing and app paths share the same trailing segment (veritacheck,
  // veritastock, veritaresponse) omit appPath and use the verbatim
  // prepend behavior.
  const wrapLegacy = (Component: any, appPath?: string) => () => (
    <LegacyWorkspaceRedirect appPath={appPath}><Component /></LegacyWorkspaceRedirect>
  );

  return (
    <div className="min-h-screen flex flex-col">
      <ScrollToTop />
      <GATracker />
      <CanonicalUpdater />
      <NavBar />
      {!isStockHost() && <SubscriptionBanner />}
      {!isStockHost() && <OnboardingBanner />}
      {!isStockHost() && <OnboardingGuard />}
      <main className="flex-1">
        <Suspense fallback={<PageFallback />}>
          <Switch>
          {/* On the veritastock.com host, "/" is the VeritaStock front door,
              not the lab HomePage. Keyed on the hostname via lib/host.ts so it
              matches the NavBar chrome. veritaslabservices.com is unaffected. */}
          <Route path="/">{isStockHost() ? <VeritaStockLandingPage /> : <HomePage />}</Route>
          <Route path="/services" component={ServicesPage} />
          <Route path="/book/scoping-call" component={BookScopingCallPage} />
          <Route path="/admin/scheduling" component={AdminSchedulingPage} />
          <Route path="/team" component={TeamPage} />
          <Route path="/veritacheck/signoff-groups">{wrapLegacy(VeritaCheckSignoffGroupsPage)}</Route>
          <Route path="/veritacheck/coverage">{wrapLegacy(VeritaCheckCoveragePage)}</Route>
          <Route path="/veritacheck">{wrapLegacy(VeritaCheckPage)}</Route>
          <Route path="/study/new">{wrapLegacy(VeritaCheckPage)}</Route>
          <Route path="/study/:id/edit">{wrapLegacy(VeritaCheckPage)}</Route>
          <Route path="/study/:id/results">{wrapLegacy(StudyResultsPage)}</Route>
          <Route path="/dashboard">{wrapLegacy(DashboardPage)}</Route>
          <Route path="/dashboard/verifications">{wrapLegacy(VeritaCheckVerificationPage)}</Route>
          <Route path="/contact" component={ContactPage} />
          <Route path="/login" component={LoginPage} />
          <Route path="/register" component={LoginPage} />
          <Route path="/join" component={JoinPage} />
          <Route path="/terms" component={TermsPage} />
          <Route path="/privacy" component={PrivacyPage} />
          <Route path="/trust" component={TrustPage} />
          <Route path="/security" component={TrustPage} />
          <Route path="/reset-password" component={ResetPasswordPage} />
          <Route path="/study-guide" component={StudyGuidePage} />
          <Route path="/book" component={BookPage} />
          <Route path="/veritascan">{wrapLegacy(VeritaScanPage, "/veritascan-app")}</Route>
          <Route path="/veritamap">{wrapLegacy(VeritaMapPage, "/veritamap-app")}</Route>
          <Route path="/demo" component={DemoSelectorPage} />
          <Route path="/demo/operations" component={DemoPage} />
          <Route path="/demo/compliance" component={DemoLabPage} />
          <Route path="/demo/cprt" component={DemoCprtPage} />
          <Route path="/demo/qc" component={DemoQcPage} />
          <Route path="/resources" component={ResourcesPage} />
          <Route path="/faq" component={FAQPage} />
          <Route path="/pricing" component={PricingPage} />
          <Route path="/request-invoice" component={RequestInvoicePage} />
          <Route path="/resources/clia-calibration-verification-method-comparison" component={ArticleCalVerPage} />
          <Route path="/resources/ep26-reagent-lot-verification" component={ArticleEP26Page} />
          <Route path="/resources/clia-tea-what-lab-directors-dont-know" component={ArticleTeaPage} />
          <Route path="/resources/how-veritaassure-trains-lab-leaders" component={ArticleTrainingPage} />
          <Route path="/resources/calibration-verification-requirements-clia" component={ArticleCLIACalVerRequirementsPage} />
          <Route path="/resources/how-to-perform-method-comparison-study" component={ArticleMethodComparisonPage} />
          <Route path="/resources/tjc-laboratory-inspection-checklist-preparation" component={ArticleTJCInspectionPage} />
          <Route path="/resources/how-to-validate-veritacheck-clia" component={ArticleValidateVeritaCheckPage} />
          <Route path="/resources/laboratory-inventory-management" component={ArticleInventoryManagementPage} />
          <Route path="/resources/manual-logs-why-most-labs-should-stop" component={ArticleManualLogsPage} />
          <Route path="/resources/clia-tea-lookup" component={TeaLookupPage} />
          <Route path="/resources/precision-verification-report-interpretation-guide" component={ArticlePrecisionInterpretationPage} />
          <Route path="/resources/verifying-reference-intervals" component={ArticleReferenceIntervalVerificationPage} />
          <Route path="/resources/quality-control-testing-into-compliance" component={ArticleQCTestingIntoCompliancePage} />
          <Route path="/resources/cost-per-reportable-test-four-layer-framework" component={ArticleCostPerReportablePage} />
          <Route path="/resources/why-veritacheck-vs-legacy-verification" component={ArticleWhyVeritaCheckPage} />
          <Route path="/veritascan-app">{wrapLegacy(VeritaScanAppPage)}</Route>
          <Route path="/veritascan-app/:id">{wrapLegacy(VeritaScanScanPage)}</Route>
          <Route path="/veritamap-app">{wrapLegacy(VeritaMapAppPage)}</Route>
          <Route path="/veritamap-app/resources">{wrapLegacy(VeritaMapResourcesPage)}</Route>
          <Route path="/veritamap-app/labwide">{wrapLegacy(VeritaMapLabwidePage)}</Route>
          <Route path="/veritatrack">{wrapLegacy(VeritaTrackPage, "/veritatrack-app")}</Route>
          <Route path="/veritatrack-app">{wrapLegacy(VeritaTrackAppPage)}</Route>
          <Route path="/veritamap-app/:id/build">{wrapLegacy(VeritaMapBuildPage)}</Route>
          <Route path="/veritamap-app/:id">{wrapLegacy(VeritaMapMapPage)}</Route>
          <Route path="/veritacomp">{wrapLegacy(VeritaCompPage, "/veritacomp-app")}</Route>
          <Route path="/veritacomp-app">{wrapLegacy(VeritaCompAppPage)}</Route>
          <Route path="/veritacomp-app/:programId">{wrapLegacy(VeritaCompAppPage)}</Route>
          <Route path="/veritapt">{wrapLegacy(VeritaPTPage, "/veritapt/app")}</Route>
          <Route path="/veritapt/app">{wrapLegacy(VeritaPTAppPage)}</Route>
          <Route path="/veritaresponse">{wrapLegacy(VeritaResponseAppPage)}</Route>
          <Route path="/veritaresponse/:id">{wrapLegacy(VeritaResponseFindingPage)}</Route>
          <Route path="/veritastaff">{wrapLegacy(VeritaStaffPage, "/veritastaff-app")}</Route>
          <Route path="/veritastaff-app">{wrapLegacy(VeritaStaffAppPage)}</Route>
          <Route path="/veritastaff-app/:employeeId">{wrapLegacy(VeritaStaffAppPage)}</Route>
          <Route path="/veritalab">{wrapLegacy(VeritaLabPage, "/veritalab-app")}</Route>
          <Route path="/veritalab-app">{wrapLegacy(VeritaLabAppPage)}</Route>
          <Route path="/veritaqc-app">{wrapLegacy(VeritaQCAppPage)}</Route>
          <Route path="/veritaqc-app/review">{wrapLegacy(VeritaQCDailyReviewPage)}</Route>
          <Route path="/veritapolicy-app">{wrapLegacy(VeritaPolicyAppPage)}</Route>
          <Route path="/veritapolicy">{wrapLegacy(VeritaPolicyPage, "/veritapolicy-app")}</Route>
          <Route path="/veritacheck/cumsum">{wrapLegacy(CumsumPage)}</Route>
          <Route path="/calculator" component={ProductivityCalculatorPage} />
          <Route path="/veritabench" component={VeritaBenchPage} />
          <Route path="/veritabench/staffing" component={VeritaBenchStaffingPage} />
          <Route path="/veritabench/pi" component={VeritaBenchPIPage} />
          <Route path="/veritastock">{wrapLegacy(VeritaStockPage)}</Route>
          <Route path="/veritastock/trends">{wrapLegacy(VeritaStockTrendsPage)}</Route>
          <Route path="/veritastock/snap-order">{wrapLegacy(VeritaStockSnapOrderPage)}</Route>
          <Route path="/veritastock/receiving">{wrapLegacy(VeritaStockReceivingPage)}</Route>
          <Route path="/veritastock/audit">{wrapLegacy(VeritaStockAuditTrailPage)}</Route>
          <Route path="/veritastock/enterprise">{wrapLegacy(VeritaStockEnterprisePage)}</Route>
          <Route path="/hospital-inventory" component={HospitalInventoryPage} />
          <Route path="/veritaops-app">{wrapLegacy(VeritaOpsAppPage)}</Route>
          <Route path="/roadmap" component={RoadmapPage} />
          <Route path="/veritaassure" component={VeritaAssurePage} />
          <Route path="/operations" component={OperationsPage} />
          <Route path="/getting-started" component={GettingStartedPage} />
          <Route path="/account/settings">{wrapLegacy(AccountSettingsPage)}</Route>
          <Route path="/account/seats">{() => { window.location.replace("/account/settings"); return null; }}</Route>
          <Route path="/account">{() => { window.location.replace("/account/settings"); return null; }}</Route>
          <Route path="/founding-lab/apply" component={FoundingLabApplyPage} />
          {/* 2026-06-12: the standalone CLIA+PIN inventory kiosk is retired
              (superseded by the Staff Portal's Adjust Inventory module when
              auth unified on email + password). Bench techs with the old
              bookmark land on the Staff Portal entry instead of a PIN prompt.
              InventoryKioskPage.tsx stays on disk (no longer imported) until
              a cleanup PR strips it. */}
          <Route path="/inventory">{() => <Redirect to="/staff-access" />}</Route>
          <Route path="/staff-access" component={StaffPortalPage} />
          <Route path="/surveyor/:token" component={SurveyorViewPage} />

          {/* Multi-Lab Tier 2 — Phase 2b: lab-scoped variants of every workspace page.
              Doc: docs/scoping-multi-lab-tier2.md. The legacy unprefixed routes above
              still resolve identically because Phase 2c has not yet flipped the API
              routes from user-scoped to /api/labs/:labId/* . Adding these variants
              now lets the NavBar LabSwitcher drive the URL contract and unblocks
              shareable cross-lab links, with no behavior change for single-lab users. */}
          <Route path="/labs/:labId/dashboard" component={DashboardPage} />
          <Route path="/labs/:labId/dashboard/verifications" component={VeritaCheckVerificationPage} />
          <Route path="/labs/:labId/study/new" component={VeritaCheckPage} />
          <Route path="/labs/:labId/study/:id/edit" component={VeritaCheckPage} />
          <Route path="/labs/:labId/study/:id/results" component={StudyResultsPage} />
          <Route path="/labs/:labId/veritascan-app" component={VeritaScanAppPage} />
          <Route path="/labs/:labId/veritascan/documents" component={VeritaScanDocumentLibraryPage} />
          <Route path="/veritascan/documents">{wrapLegacy(VeritaScanDocumentLibraryPage)}</Route>
          <Route path="/labs/:labId/veritascan/inspection-proof" component={VeritaScanInspectionProofPage} />
          <Route path="/veritascan/inspection-proof">{wrapLegacy(VeritaScanInspectionProofPage)}</Route>
          <Route path="/labs/:labId/veritascan-app/:id" component={VeritaScanScanPage} />
          <Route path="/labs/:labId/veritamap-app" component={VeritaMapAppPage} />
          <Route path="/labs/:labId/veritamap-app/resources" component={VeritaMapResourcesPage} />
          <Route path="/labs/:labId/veritamap-app/labwide" component={VeritaMapLabwidePage} />
          <Route path="/labs/:labId/veritamap-app/:id/build" component={VeritaMapBuildPage} />
          <Route path="/labs/:labId/veritamap-app/:id" component={VeritaMapMapPage} />
          <Route path="/labs/:labId/veritatrack-app" component={VeritaTrackAppPage} />
          <Route path="/labs/:labId/veritacomp-app" component={VeritaCompAppPage} />
          <Route path="/labs/:labId/veritacomp-app/:programId" component={VeritaCompAppPage} />
          <Route path="/labs/:labId/veritapt/app" component={VeritaPTAppPage} />
          <Route path="/labs/:labId/veritaresponse" component={VeritaResponseAppPage} />
          <Route path="/labs/:labId/veritaresponse/:id" component={VeritaResponseFindingPage} />
          <Route path="/labs/:labId/veritastaff-app" component={VeritaStaffAppPage} />
          <Route path="/labs/:labId/veritastaff-app/:employeeId" component={VeritaStaffAppPage} />
          <Route path="/labs/:labId/veritalab-app" component={VeritaLabAppPage} />
          <Route path="/labs/:labId/veritaqc-app" component={VeritaQCAppPage} />
          <Route path="/labs/:labId/veritaqc-app/review" component={VeritaQCDailyReviewPage} />
          <Route path="/labs/:labId/veritapolicy-app" component={VeritaPolicyAppPage} />
          <Route path="/labs/:labId/veritapolicy-app/my-policies" component={VeritaPolicyMyPoliciesPage} />
          <Route path="/labs/:labId/veritapolicy-app/compliance" component={VeritaPolicyCompliancePage} />
          <Route path="/labs/:labId/veritacheck/signoff-groups" component={VeritaCheckSignoffGroupsPage} />
          <Route path="/labs/:labId/veritacheck/coverage" component={VeritaCheckCoveragePage} />
          <Route path="/labs/:labId/veritacheck" component={VeritaCheckPage} />
          <Route path="/labs/:labId/veritacheck/cumsum" component={CumsumPage} />
          <Route path="/labs/:labId/veritastock" component={VeritaStockPage} />
          <Route path="/labs/:labId/veritastock/trends" component={VeritaStockTrendsPage} />
          <Route path="/labs/:labId/veritastock/snap-order" component={VeritaStockSnapOrderPage} />
          <Route path="/labs/:labId/veritastock/receiving" component={VeritaStockReceivingPage} />
          <Route path="/labs/:labId/veritastock/audit" component={VeritaStockAuditTrailPage} />
          <Route path="/labs/:labId/veritastock/enterprise" component={VeritaStockEnterprisePage} />
          <Route path="/labs/:labId/veritastock/vendors" component={VeritaStockVendorsPage} />
          <Route path="/labs/:labId/veritaops-app" component={VeritaOpsAppPage} />
          <Route path="/labs/:labId/account/settings" component={AccountSettingsPage} />
          <Route path="/labs/:labId/members" component={LabMembersPage} />
          {/* Bare /members is a natural guessed URL (it 404'd on Michael
              2026-06-12); LegacyWorkspaceRedirect forwards it to the primary
              lab's members page once memberships load. */}
          <Route path="/members">{wrapLegacy(LabMembersPage)}</Route>

          <Route component={NotFound} />
        </Switch>
          </Suspense>
      </main>
      <SiteFooter />
      <BackToTop />
      <Toaster />
      <SubscriptionModal />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <AuthProvider>
            <Router>
              <AppContent />
            </Router>
          </AuthProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
