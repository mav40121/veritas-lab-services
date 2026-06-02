import { Switch, Route, Router, useLocation } from "wouter";
import VeritaCheckVerificationPage from "@/pages/VeritaCheckVerificationPage";
import ArticleInventoryManagementPage from "@/pages/ArticleInventoryManagementPage";
import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
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
import ServicesPage from "@/pages/ServicesPage";
import BookScopingCallPage from "@/pages/BookScopingCallPage";
import AdminSchedulingPage from "@/pages/AdminSchedulingPage";
import TeamPage from "@/pages/TeamPage";
import VeritaCheckPage from "@/pages/VeritaCheckPage";
import StudyResultsPage from "@/pages/StudyResultsPage";
import DashboardPage from "@/pages/DashboardPage";
import ContactPage from "@/pages/ContactPage";
import LoginPage from "@/pages/LoginPage";
import NotFound from "@/pages/not-found";
import TermsPage from "@/pages/TermsPage";
import PrivacyPage from "@/pages/PrivacyPage";
import TrustPage from "@/pages/TrustPage";
import ResetPasswordPage from "@/pages/ResetPasswordPage";
import StudyGuidePage from "@/pages/StudyGuidePage";
import BookPage from "@/pages/BookPage";
import VeritaScanPage from "@/pages/VeritaScanPage";
import VeritaMapPage from "@/pages/VeritaMapPage";
import DemoLabPage from "@/pages/DemoLabPage";
import DemoPage from "@/pages/DemoPage";
import DemoSelectorPage from "@/pages/DemoSelectorPage";
import DemoCprtPage from "@/pages/DemoCprtPage";
import DemoQcPage from "@/pages/DemoQcPage";
import ResourcesPage from "@/pages/ResourcesPage";
import ArticlePrecisionInterpretationPage from "@/pages/ArticlePrecisionInterpretationPage";
import ArticleCostPerReportablePage from "@/pages/ArticleCostPerReportablePage";
import ArticleWhyVeritaCheckPage from "@/pages/ArticleWhyVeritaCheckPage";
import FAQPage from "@/pages/FAQPage";
import PricingPage from "@/pages/PricingPage";
import ArticleCalVerPage from "@/pages/ArticleCalVerPage";
import ArticleTeaPage from "@/pages/ArticleTeaPage";
import ArticleTrainingPage from "@/pages/ArticleTrainingPage";
import ArticleCLIACalVerRequirementsPage from "@/pages/ArticleCLIACalVerRequirementsPage";
import ArticleMethodComparisonPage from "@/pages/ArticleMethodComparisonPage";
import ArticleTJCInspectionPage from "@/pages/ArticleTJCInspectionPage";
import ArticleValidateVeritaCheckPage from "@/pages/ArticleValidateVeritaCheckPage";
import ArticleManualLogsPage from "@/pages/ArticleManualLogsPage";
import TeaLookupPage from "@/pages/TeaLookupPage";
import VeritaScanAppPage from "@/pages/VeritaScanAppPage";
import VeritaScanScanPage from "@/pages/VeritaScanScanPage";
import VeritaScanDocumentLibraryPage from "@/pages/VeritaScanDocumentLibraryPage";
import VeritaMapAppPage from "@/pages/VeritaMapAppPage";
import VeritaMapBuildPage from "@/pages/VeritaMapBuildPage";
import VeritaMapMapPage from "@/pages/VeritaMapMapPage";
import VeritaMapResourcesPage from "@/pages/VeritaMapResourcesPage";
import VeritaMapLabwidePage from "@/pages/VeritaMapLabwidePage";
import VeritaTrackAppPage from "@/pages/VeritaTrackAppPage";
import VeritaTrackPage from "@/pages/VeritaTrackPage";
import VeritaCompPage from "@/pages/VeritaCompPage";
import VeritaCompAppPage from "@/pages/VeritaCompAppPage";
import VeritaPTPage from "@/pages/VeritaPTPage";
import VeritaPTAppPage from "@/pages/VeritaPTAppPage";
import VeritaResponseAppPage from "@/pages/VeritaResponseAppPage";
import VeritaResponseFindingPage from "@/pages/VeritaResponseFindingPage";
import VeritaStaffPage from "@/pages/VeritaStaffPage";
import VeritaStaffAppPage from "@/pages/VeritaStaffAppPage";
import VeritaLabPage from "@/pages/VeritaLabPage";
import VeritaLabAppPage from "@/pages/VeritaLabAppPage";
import VeritaQCAppPage from "@/pages/VeritaQCAppPage";
import VeritaQCDailyReviewPage from "@/pages/VeritaQCDailyReviewPage";
import VeritaPolicyAppPage from "@/pages/VeritaPolicyAppPage";
import VeritaPolicyMyPoliciesPage from "@/pages/VeritaPolicyMyPoliciesPage";
import VeritaPolicyCompliancePage from "@/pages/VeritaPolicyCompliancePage";
import SurveyorViewPage from "@/pages/SurveyorViewPage";
import VeritaPolicyPage from "@/pages/VeritaPolicyPage";
import CumsumPage from "@/pages/CumsumPage";
import RoadmapPage from "@/pages/RoadmapPage";
import GettingStartedPage from "@/pages/GettingStartedPage";
import AccountSettingsPage from "@/pages/AccountSettingsPage";
import VeritaAssurePage from "@/pages/VeritaAssurePage";
import OperationsPage from "@/pages/OperationsPage";
import AdminReportPage from "@/pages/AdminReportPage";
import JoinPage from "@/pages/JoinPage";
import ProductivityCalculatorPage from "@/pages/ProductivityCalculatorPage";
import VeritaBenchPage from "@/pages/VeritaBenchPage";
import VeritaBenchStaffingPage from "@/pages/VeritaBenchStaffingPage";
import VeritaStockPage from "@/pages/VeritaStockPage";
import VeritaStockSnapOrderPage from "@/pages/VeritaStockSnapOrderPage";
import VeritaOpsAppPage from "@/pages/VeritaOpsAppPage";
import LabMembersPage from "@/pages/LabMembersPage";
import FoundingLabApplyPage from "@/pages/FoundingLabApplyPage";
import VeritaBenchPIPage from "@/pages/VeritaBenchPIPage";
import RequestInvoicePage from "@/pages/RequestInvoicePage";
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

function AppContent() {
  const [location] = useLocation();

  // Standalone admin page: no NavBar, no footer, no subscription banners
  if (location === "/admin") {
    return <AdminReportPage />;
  }

  // Phase 2c: wraps a legacy workspace page component so unauthenticated /
  // single-lab / no-lab cases pass through untouched, while logged-in users
  // with at least one membership get client-side redirected to the
  // lab-scoped form. See client/src/components/LegacyWorkspaceRedirect.tsx.
  const wrapLegacy = (Component: any) => () => (
    <LegacyWorkspaceRedirect><Component /></LegacyWorkspaceRedirect>
  );

  return (
    <div className="min-h-screen flex flex-col">
      <ScrollToTop />
      <GATracker />
      <CanonicalUpdater />
      <NavBar />
      <SubscriptionBanner />
      <OnboardingBanner />
      <OnboardingGuard />
      <main className="flex-1">
        <Switch>
          <Route path="/" component={HomePage} />
          <Route path="/services" component={ServicesPage} />
          <Route path="/book/scoping-call" component={BookScopingCallPage} />
          <Route path="/admin/scheduling" component={AdminSchedulingPage} />
          <Route path="/team" component={TeamPage} />
          <Route path="/veritacheck" component={VeritaCheckPage} />
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
          <Route path="/veritascan" component={VeritaScanPage} />
          <Route path="/veritamap" component={VeritaMapPage} />
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
          <Route path="/resources/cost-per-reportable-test-four-layer-framework" component={ArticleCostPerReportablePage} />
          <Route path="/resources/why-veritacheck-vs-legacy-verification" component={ArticleWhyVeritaCheckPage} />
          <Route path="/veritascan-app">{wrapLegacy(VeritaScanAppPage)}</Route>
          <Route path="/veritascan-app/:id">{wrapLegacy(VeritaScanScanPage)}</Route>
          <Route path="/veritamap-app">{wrapLegacy(VeritaMapAppPage)}</Route>
          <Route path="/veritamap-app/resources">{wrapLegacy(VeritaMapResourcesPage)}</Route>
          <Route path="/veritamap-app/labwide">{wrapLegacy(VeritaMapLabwidePage)}</Route>
          <Route path="/veritatrack" component={VeritaTrackPage} />
          <Route path="/veritatrack-app">{wrapLegacy(VeritaTrackAppPage)}</Route>
          <Route path="/veritamap-app/:id/build">{wrapLegacy(VeritaMapBuildPage)}</Route>
          <Route path="/veritamap-app/:id">{wrapLegacy(VeritaMapMapPage)}</Route>
          <Route path="/veritacomp" component={VeritaCompPage} />
          <Route path="/veritacomp-app">{wrapLegacy(VeritaCompAppPage)}</Route>
          <Route path="/veritacomp-app/:programId">{wrapLegacy(VeritaCompAppPage)}</Route>
          <Route path="/veritapt" component={VeritaPTPage} />
          <Route path="/veritapt/app">{wrapLegacy(VeritaPTAppPage)}</Route>
          <Route path="/veritaresponse">{wrapLegacy(VeritaResponseAppPage)}</Route>
          <Route path="/veritaresponse/:id">{wrapLegacy(VeritaResponseFindingPage)}</Route>
          <Route path="/veritastaff" component={VeritaStaffPage} />
          <Route path="/veritastaff-app">{wrapLegacy(VeritaStaffAppPage)}</Route>
          <Route path="/veritastaff-app/:employeeId">{wrapLegacy(VeritaStaffAppPage)}</Route>
          <Route path="/veritalab" component={VeritaLabPage} />
          <Route path="/veritalab-app">{wrapLegacy(VeritaLabAppPage)}</Route>
          <Route path="/veritaqc-app">{wrapLegacy(VeritaQCAppPage)}</Route>
          <Route path="/veritaqc-app/review">{wrapLegacy(VeritaQCDailyReviewPage)}</Route>
          <Route path="/veritapolicy-app">{wrapLegacy(VeritaPolicyAppPage)}</Route>
          <Route path="/veritapolicy" component={VeritaPolicyPage} />
          <Route path="/veritacheck/cumsum">{wrapLegacy(CumsumPage)}</Route>
          <Route path="/calculator" component={ProductivityCalculatorPage} />
          <Route path="/veritabench" component={VeritaBenchPage} />
          <Route path="/veritabench/staffing" component={VeritaBenchStaffingPage} />
          <Route path="/veritabench/pi" component={VeritaBenchPIPage} />
          <Route path="/veritastock">{wrapLegacy(VeritaStockPage)}</Route>
          <Route path="/veritastock/snap-order">{wrapLegacy(VeritaStockSnapOrderPage)}</Route>
          <Route path="/veritaops-app">{wrapLegacy(VeritaOpsAppPage)}</Route>
          <Route path="/roadmap" component={RoadmapPage} />
          <Route path="/veritaassure" component={VeritaAssurePage} />
          <Route path="/operations" component={OperationsPage} />
          <Route path="/getting-started" component={GettingStartedPage} />
          <Route path="/account/settings">{wrapLegacy(AccountSettingsPage)}</Route>
          <Route path="/account/seats">{() => { window.location.replace("/account/settings"); return null; }}</Route>
          <Route path="/account">{() => { window.location.replace("/account/settings"); return null; }}</Route>
          <Route path="/founding-lab/apply" component={FoundingLabApplyPage} />
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
          <Route path="/labs/:labId/veritacheck" component={VeritaCheckPage} />
          <Route path="/labs/:labId/veritacheck/cumsum" component={CumsumPage} />
          <Route path="/labs/:labId/veritastock" component={VeritaStockPage} />
          <Route path="/labs/:labId/veritastock/snap-order" component={VeritaStockSnapOrderPage} />
          <Route path="/labs/:labId/veritaops-app" component={VeritaOpsAppPage} />
          <Route path="/labs/:labId/account/settings" component={AccountSettingsPage} />
          <Route path="/labs/:labId/members" component={LabMembersPage} />

          <Route component={NotFound} />
        </Switch>
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
