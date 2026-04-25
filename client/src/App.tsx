import { Switch, Route, Router, useLocation } from "wouter";
import VeritaCheckVerificationPage from "@/pages/VeritaCheckVerificationPage";
import ArticleInventoryManagementPage from "@/pages/ArticleInventoryManagementPage";
import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { PerplexityAttribution } from "@/components/PerplexityAttribution";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AuthProvider, useAuth } from "@/components/AuthContext";
import { NavBar } from "@/components/NavBar";
import { SubscriptionBanner } from "@/components/SubscriptionBanner";
import { SubscriptionModal } from "@/components/SubscriptionModal";
import { OnboardingWizard } from "@/components/OnboardingWizard";
import { ChevronUp } from "lucide-react";
import HomePage from "@/pages/HomePage";
import ServicesPage from "@/pages/ServicesPage";
import TeamPage from "@/pages/TeamPage";
import VeritaCheckPage from "@/pages/VeritaCheckPage";
import StudyResultsPage from "@/pages/StudyResultsPage";
import DashboardPage from "@/pages/DashboardPage";
import ContactPage from "@/pages/ContactPage";
import LoginPage from "@/pages/LoginPage";
import NotFound from "@/pages/not-found";
import TermsPage from "@/pages/TermsPage";
import PrivacyPage from "@/pages/PrivacyPage";
import ResetPasswordPage from "@/pages/ResetPasswordPage";
import StudyGuidePage from "@/pages/StudyGuidePage";
import BookPage from "@/pages/BookPage";
import VeritaScanPage from "@/pages/VeritaScanPage";
import VeritaMapPage from "@/pages/VeritaMapPage";
import DemoLabPage from "@/pages/DemoLabPage";
import DemoPage from "@/pages/DemoPage";
import DemoSelectorPage from "@/pages/DemoSelectorPage";
import ResourcesPage from "@/pages/ResourcesPage";
import FAQPage from "@/pages/FAQPage";
import PricingPage from "@/pages/PricingPage";
import ArticleCalVerPage from "@/pages/ArticleCalVerPage";
import ArticleTeaPage from "@/pages/ArticleTeaPage";
import ArticleTrainingPage from "@/pages/ArticleTrainingPage";
import ArticleCLIACalVerRequirementsPage from "@/pages/ArticleCLIACalVerRequirementsPage";
import ArticleMethodComparisonPage from "@/pages/ArticleMethodComparisonPage";
import ArticleTJCInspectionPage from "@/pages/ArticleTJCInspectionPage";
import ArticleValidateVeritaCheckPage from "@/pages/ArticleValidateVeritaCheckPage";
import TeaLookupPage from "@/pages/TeaLookupPage";
import VeritaScanAppPage from "@/pages/VeritaScanAppPage";
import VeritaScanScanPage from "@/pages/VeritaScanScanPage";
import VeritaMapAppPage from "@/pages/VeritaMapAppPage";
import VeritaMapBuildPage from "@/pages/VeritaMapBuildPage";
import VeritaMapMapPage from "@/pages/VeritaMapMapPage";
import VeritaMapResourcesPage from "@/pages/VeritaMapResourcesPage";
import VeritaTrackAppPage from "@/pages/VeritaTrackAppPage";
import VeritaTrackPage from "@/pages/VeritaTrackPage";
import VeritaCompPage from "@/pages/VeritaCompPage";
import VeritaCompAppPage from "@/pages/VeritaCompAppPage";
import VeritaPTPage from "@/pages/VeritaPTPage";
import VeritaPTAppPage from "@/pages/VeritaPTAppPage";
import VeritaStaffPage from "@/pages/VeritaStaffPage";
import VeritaStaffAppPage from "@/pages/VeritaStaffAppPage";
import VeritaLabPage from "@/pages/VeritaLabPage";
import VeritaLabAppPage from "@/pages/VeritaLabAppPage";
import VeritaPolicyAppPage from "@/pages/VeritaPolicyAppPage";
import VeritaPolicyPage from "@/pages/VeritaPolicyPage";
import CumsumPage from "@/pages/CumsumPage";
import SeatManagementPage from "@/pages/SeatManagementPage";
import RoadmapPage from "@/pages/RoadmapPage";
import GettingStartedPage from "@/pages/GettingStartedPage";
import AccountSettingsPage from "@/pages/AccountSettingsPage";
import VeritaAssurePage from "@/pages/VeritaAssurePage";
import AdminReportPage from "@/pages/AdminReportPage";
import JoinPage from "@/pages/JoinPage";
import ProductivityCalculatorPage from "@/pages/ProductivityCalculatorPage";
import VeritaBenchPage from "@/pages/VeritaBenchPage";
import VeritaBenchStaffingPage from "@/pages/VeritaBenchStaffingPage";
import VeritaStockPage from "@/pages/VeritaStockPage";
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
          <a href="https://www.perplexity.ai/computer" target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            Created with Perplexity Computer
          </a>
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
          <Route path="/team" component={TeamPage} />
          <Route path="/veritacheck" component={VeritaCheckPage} />
          <Route path="/study/new" component={VeritaCheckPage} />
          <Route path="/study/:id/results" component={StudyResultsPage} />
          <Route path="/dashboard" component={DashboardPage} />
          <Route path="/dashboard/verifications" component={VeritaCheckVerificationPage} />
          <Route path="/contact" component={ContactPage} />
          <Route path="/login" component={LoginPage} />
          <Route path="/register" component={LoginPage} />
          <Route path="/join" component={JoinPage} />
          <Route path="/terms" component={TermsPage} />
          <Route path="/privacy" component={PrivacyPage} />
          <Route path="/reset-password" component={ResetPasswordPage} />
          <Route path="/study-guide" component={StudyGuidePage} />
          <Route path="/book" component={BookPage} />
          <Route path="/veritascan" component={VeritaScanPage} />
          <Route path="/veritamap" component={VeritaMapPage} />
          <Route path="/demo" component={DemoSelectorPage} />
          <Route path="/demo/operations" component={DemoPage} />
          <Route path="/demo/compliance" component={DemoLabPage} />
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
          <Route path="/resources/clia-tea-lookup" component={TeaLookupPage} />
          <Route path="/veritascan-app" component={VeritaScanAppPage} />
          <Route path="/veritascan-app/:id" component={VeritaScanScanPage} />
          <Route path="/veritamap-app" component={VeritaMapAppPage} />
          <Route path="/veritamap-app/resources" component={VeritaMapResourcesPage} />
          <Route path="/veritatrack" component={VeritaTrackPage} />
          <Route path="/veritatrack-app" component={VeritaTrackAppPage} />
          <Route path="/veritamap-app/:id/build" component={VeritaMapBuildPage} />
          <Route path="/veritamap-app/:id" component={VeritaMapMapPage} />
          <Route path="/veritacomp" component={VeritaCompPage} />
          <Route path="/veritacomp-app" component={VeritaCompAppPage} />
          <Route path="/veritacomp-app/:programId" component={VeritaCompAppPage} />
          <Route path="/veritapt" component={VeritaPTPage} />
          <Route path="/veritapt/app" component={VeritaPTAppPage} />
          <Route path="/veritastaff" component={VeritaStaffPage} />
          <Route path="/veritastaff-app" component={VeritaStaffAppPage} />
          <Route path="/veritastaff-app/:employeeId" component={VeritaStaffAppPage} />
          <Route path="/veritalab" component={VeritaLabPage} />
          <Route path="/veritalab-app" component={VeritaLabAppPage} />
          <Route path="/veritapolicy-app" component={VeritaPolicyAppPage} />
          <Route path="/veritapolicy" component={VeritaPolicyPage} />
          <Route path="/veritacheck/cumsum" component={CumsumPage} />
          <Route path="/calculator" component={ProductivityCalculatorPage} />
          <Route path="/veritabench" component={VeritaBenchPage} />
          <Route path="/veritabench/staffing" component={VeritaBenchStaffingPage} />
          <Route path="/veritabench/pi" component={VeritaBenchPIPage} />
          <Route path="/veritastock" component={VeritaStockPage} />
          <Route path="/roadmap" component={RoadmapPage} />
          <Route path="/veritaassure" component={VeritaAssurePage} />
          <Route path="/getting-started" component={GettingStartedPage} />
          <Route path="/account/settings" component={AccountSettingsPage} />
          <Route path="/account/seats" component={SeatManagementPage} />
          <Route path="/account">{() => { window.location.replace("/account/settings"); return null; }}</Route>
          <Route component={NotFound} />
        </Switch>
      </main>
      <SiteFooter />
      <BackToTop />
      <Toaster />
      <SubscriptionModal />
      <PerplexityAttribution />
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
