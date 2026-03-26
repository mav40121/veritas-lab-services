import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { PerplexityAttribution } from "@/components/PerplexityAttribution";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AuthProvider } from "@/components/AuthContext";
import { NavBar } from "@/components/NavBar";
import HomePage from "@/pages/HomePage";
import ServicesPage from "@/pages/ServicesPage";
import TeamPage from "@/pages/TeamPage";
import VeritaCheckPage from "@/pages/VeritaCheckPage";
import StudyResultsPage from "@/pages/StudyResultsPage";
import DashboardPage from "@/pages/DashboardPage";
import ContactPage from "@/pages/ContactPage";
import LoginPage from "@/pages/LoginPage";
import NotFound from "@/pages/not-found";

function SiteFooter() {
  return (
    <footer className="border-t border-border bg-card">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
        <div className="grid sm:grid-cols-3 gap-8 mb-8">
          <div>
            <div className="font-serif font-bold text-base mb-2">Veritas Lab Services, LLC</div>
            <p className="text-sm text-muted-foreground leading-relaxed">Expert clinical laboratory consulting — leadership coaching, regulatory readiness, productivity analysis, and VeritaCheck EP analysis.</p>
          </div>
          <div>
            <div className="font-semibold text-sm mb-3">Services</div>
            <ul className="space-y-1.5 text-sm text-muted-foreground">
              {["Leadership Coaching","Inspection Readiness","Productivity Analysis","Regulatory Preparedness","VeritaCheck EP Analysis"].map(s => <li key={s}>{s}</li>)}
            </ul>
          </div>
          <div>
            <div className="font-semibold text-sm mb-3">Contact</div>
            <p className="text-sm text-muted-foreground">VeriLabGuy@gmail.com</p>
            <p className="text-sm text-muted-foreground mt-1">We respond to emails promptly.</p>
            <div className="mt-3">
              <div className="font-semibold text-sm mb-2">Resources</div>
              <ul className="space-y-1 text-sm text-muted-foreground">
                <li><a href="https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493" target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">CLIA Regulations (eCFR)</a></li>
                <li><a href="https://www.cms.gov/medicare/quality/clinical-laboratory-improvement-amendments/brochures" target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">CLIA Brochures (CMS)</a></li>
                <li><a href="https://www.medlabmag.com" target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">Medical Lab Management</a></li>
              </ul>
            </div>
          </div>
        </div>
        <div className="border-t border-border pt-5 flex flex-col sm:flex-row justify-between items-center gap-3">
          <p className="text-xs text-muted-foreground">© 2026 Veritas Lab Services, LLC — All Rights Reserved</p>
          <a href="https://www.perplexity.ai/computer" target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            Created with Perplexity Computer
          </a>
        </div>
      </div>
    </footer>
  );
}

function AppContent() {
  return (
    <div className="min-h-screen flex flex-col">
      <NavBar />
      <main className="flex-1">
        <Switch>
          <Route path="/" component={HomePage} />
          <Route path="/services" component={ServicesPage} />
          <Route path="/team" component={TeamPage} />
          <Route path="/veritacheck" component={VeritaCheckPage} />
          <Route path="/study/:id/results" component={StudyResultsPage} />
          <Route path="/dashboard" component={DashboardPage} />
          <Route path="/contact" component={ContactPage} />
          <Route path="/login" component={LoginPage} />
          <Route component={NotFound} />
        </Switch>
      </main>
      <SiteFooter />
      <Toaster />
      <PerplexityAttribution />
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <Router hook={useHashLocation}>
            <AppContent />
          </Router>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
