import { useSEO } from "@/hooks/useSEO";

export default function TrustPage() {
  useSEO({
    title: "Trust & Security | Veritas Lab Services",
    description:
      "How VeritaAssure™ protects your laboratory data: hosting, encryption, multi-lab isolation, PHI-free design, subprocessors, and HIPAA BAA availability.",
  });

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16">
      <h1 className="font-serif text-3xl font-bold mb-2">Trust & Security</h1>
      <p className="text-sm text-muted-foreground mb-8">Effective Date: May 17, 2026 · Veritas Lab Services, LLC</p>

      <div className="prose prose-sm dark:prose-invert max-w-none space-y-6 text-sm leading-relaxed">

        <section>
          <h2 className="font-semibold text-base mb-2">1. Overview</h2>
          <p>VeritaAssure&trade; is operated by Veritas Lab Services, LLC. This page describes the technical and operational measures we use to protect customer data. It is a companion to our <a href="/privacy" className="text-primary hover:underline">Privacy Policy</a>, which covers what we collect and how we use it. This page covers how we protect it.</p>
          <p>If anything on this page is unclear or you need specific assurances for a procurement review, contact <a href="mailto:info@veritaslabservices.com" className="text-primary hover:underline">info@veritaslabservices.com</a>.</p>
        </section>

        <section>
          <h2 className="font-semibold text-base mb-2">2. Where Your Data Lives</h2>
          <p>Application servers and the production database are hosted by Railway (railway.app) on infrastructure located in the United States. The application runs in a managed container with an attached persistent volume for the application database (SQLite). Customer data is logically isolated within the database via lab membership (see section 5), not by separate database instances per customer. We do not subprocess data hosting through any third party other than the providers listed in section 6.</p>
        </section>

        <section>
          <h2 className="font-semibold text-base mb-2">3. How Your Data Is Protected</h2>
          <ul className="list-disc pl-5 space-y-2">
            <li><strong>Encryption in transit:</strong> All traffic to and from veritaslabservices.com uses TLS 1.2 or higher. The apex domain redirects to https://www.veritaslabservices.com and HTTP requests are rejected.</li>
            <li><strong>Authentication:</strong> Sessions are managed via JSON Web Tokens (JWT) signed with a per-deployment secret. Account passwords are hashed using bcrypt before storage; we do not store plaintext passwords.</li>
            <li><strong>Multi-lab isolation:</strong> Every record in the database is scoped to a specific lab via a foreign key. API endpoints enforce per-lab membership checks before returning data, so a member of Lab A cannot read or modify records belonging to Lab B even if they share infrastructure.</li>
            <li><strong>Payment data:</strong> Credit card numbers and full payment details are handled entirely by Stripe (PCI DSS Level 1 certified). We never see, store, or log card numbers.</li>
          </ul>
        </section>

        <section>
          <h2 className="font-semibold text-base mb-2">4. What We Do Not Store</h2>
          <p>VeritaAssure&trade; is designed for laboratory quality assurance and compliance documentation, not patient care. By policy and by design we do not store Protected Health Information (PHI):</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>No patient names, dates of birth, medical record numbers, or other patient identifiers</li>
            <li>No clinical results tied to identified individuals</li>
            <li>No images, scans, or attachments containing PHI</li>
          </ul>
          <p>The VeritaResponse&trade; finding-management module enforces this in-app: it is labeled a "PHI-free zone" and instructs users to reference patients or samples by internal case number, never by name or MRN. Specimen concentration values entered into VeritaCheck&trade; should likewise be de-identified before entry.</p>
        </section>

        <section>
          <h2 className="font-semibold text-base mb-2">5. Account and Customer Isolation</h2>
          <p>VeritaAssure&trade; supports multi-lab organizations through an explicit lab membership model. When a user belongs to multiple labs, only data scoped to a lab they actively belong to is returned by the API. Membership is checked on every read and every write, not just at login.</p>
        </section>

        <section>
          <h2 className="font-semibold text-base mb-2">6. Subprocessors</h2>
          <p>We use the following third-party services. Each operates under their own published security and privacy policies.</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Railway</strong> : Application hosting and database storage. SOC 2 Type II + SOC 3 certified. <a href="https://railway.app/legal/privacy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Railway Privacy Policy</a> / <a href="https://trust.railway.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Railway Trust Center</a></li>
            <li><strong>Cloudflare R2</strong> : Off-site database backup storage. SOC 2 Type II certified. <a href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Cloudflare Privacy Policy</a></li>
            <li><strong>Stripe</strong> : Payment processing. PCI DSS Level 1 certified. <a href="https://stripe.com/privacy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Stripe Privacy Policy</a></li>
            <li><strong>Resend</strong> : Transactional email (password reset, billing receipts). <a href="https://resend.com/legal/privacy-policy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Resend Privacy Policy</a></li>
            <li><strong>Sentry</strong> : Application error monitoring. PII is redacted before transmission (<code>sendDefaultPii: false</code>). <a href="https://sentry.io/privacy/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Sentry Privacy Policy</a></li>
          </ul>
        </section>

        <section>
          <h2 className="font-semibold text-base mb-2">7. Error Monitoring</h2>
          <p>We use Sentry to capture uncaught application errors so we can fix them quickly. The Sentry SDK is configured with <code>sendDefaultPii: false</code>, which means user identifiers, IP addresses, and request bodies are not transmitted to Sentry. Only the error type, stack trace, and route name leave our servers.</p>
        </section>

        <section>
          <h2 className="font-semibold text-base mb-2">8. Backups and Disaster Recovery</h2>
          <p>The production database is backed up nightly to an independent S3-compatible object storage provider (Cloudflare R2) in a different vendor than the application host. Backups are gzip-compressed, retained for two years (730 days), and pruned automatically. Each backup run is validated against a five-point integrity check (file size, SQLite structural integrity, user count, study count, table count); anomalies trigger an email alert. The backup destination is access-controlled with a bucket-scoped credential that cannot read or modify anything else in the operator's account.</p>
          <p>Customer database snapshots are also available on request. Send a request to <a href="mailto:info@veritaslabservices.com" className="text-primary hover:underline">info@veritaslabservices.com</a> and we will provide a current snapshot within five business days.</p>
        </section>

        <section>
          <h2 className="font-semibold text-base mb-2">9. Compliance Certifications</h2>
          <p>Veritas Lab Services is not currently SOC 2 certified. We do not have a formal roadmap date for pursuing a SOC 2 attestation; this page will be updated if and when that changes. We assess this honestly because most early-stage clinical lab compliance tools do not hold SOC 2, and we would rather state that plainly than imply otherwise.</p>
          <p>That said, our application runs on infrastructure provided by vendors that do hold relevant certifications: <strong>Railway</strong> (SOC 2 Type II + SOC 3 for hosting and database storage), <strong>Cloudflare</strong> (SOC 2 Type II for backup storage), and <strong>Stripe</strong> (PCI DSS Level 1 for payment processing). When a customer security questionnaire asks about specific controls in those layers, we point to those upstream attestations rather than restating them ourselves.</p>
          <p>The application is designed to operate under CLIA, TJC, CAP, and COLA documentation requirements that customers themselves are subject to. We do not represent that our software is certified by any of those accreditors; rather, the outputs (PDFs, audit trails, reports) are designed to satisfy their documentation requirements when generated and reviewed by a qualified laboratory professional.</p>
        </section>

        <section>
          <h2 className="font-semibold text-base mb-2">10. HIPAA Business Associate Agreement</h2>
          <p>Because VeritaAssure&trade; is designed to operate without PHI (see section 4), most customers do not need a Business Associate Agreement. For customers whose compliance program requires a BAA on file for every vendor regardless, we can provide one on request. Contact <a href="mailto:info@veritaslabservices.com" className="text-primary hover:underline">info@veritaslabservices.com</a>.</p>
        </section>

        <section>
          <h2 className="font-semibold text-base mb-2">11. Reporting Security Issues</h2>
          <p>If you believe you have found a security vulnerability in VeritaAssure&trade;, please send a description to <a href="mailto:info@veritaslabservices.com" className="text-primary hover:underline">info@veritaslabservices.com</a> with the subject line "Security Report". Include reproduction steps where possible and please do not publicly disclose the issue before we have had a chance to respond.</p>
          <p>We will acknowledge receipt within five business days and provide an update on remediation within thirty days for confirmed issues. We do not currently operate a paid bug-bounty program, but we will publicly credit responsible disclosures with the reporter's permission.</p>
        </section>

        <section>
          <h2 className="font-semibold text-base mb-2">12. Contact</h2>
          <p>Security or compliance questions: <a href="mailto:info@veritaslabservices.com" className="text-primary hover:underline">info@veritaslabservices.com</a><br />Veritas Lab Services, LLC &middot; Upton, Massachusetts</p>
        </section>

      </div>
    </div>
  );
}
