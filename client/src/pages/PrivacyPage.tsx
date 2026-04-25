export default function PrivacyPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16">
      <h1 className="font-serif text-3xl font-bold mb-2">Privacy Policy</h1>
      <p className="text-sm text-muted-foreground mb-8">Effective Date: March 27, 2026 · Veritas Lab Services, LLC</p>

      <div className="prose prose-sm dark:prose-invert max-w-none space-y-6 text-sm leading-relaxed">

        <section>
          <h2 className="font-semibold text-base mb-2">1. Overview</h2>
          <p>Veritas Lab Services, LLC ("Company," "we," "us") operates VeritaCheck™ at veritaslabservices.com. This Privacy Policy describes how we collect, use, and protect information you provide when using the Service.</p>
        </section>

        <section>
          <h2 className="font-semibold text-base mb-2">2. Information We Collect</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Account information:</strong> Name, email address, and password (hashed, we never store plaintext passwords)</li>
            <li><strong>Study data:</strong> Analyte names, instrument names, analyst initials, dates, and numerical concentration values you enter when running studies</li>
            <li><strong>Payment information:</strong> Processed entirely by Stripe. We do not store card numbers or full payment details</li>
            <li><strong>Usage data:</strong> Standard server logs including IP addresses and browser type, retained for up to 90 days</li>
          </ul>
        </section>

        <section>
          <h2 className="font-semibold text-base mb-2">3. What We Do Not Collect</h2>
          <p>VeritaCheck™ is designed for laboratory quality assurance, not patient care. We do not collect, store, or process Protected Health Information (PHI) as defined by HIPAA. Specimen concentration values entered into the Service should not include patient names, dates of birth, medical record numbers, or any other patient identifiers. Do not enter PHI into this Service.</p>
        </section>

        <section>
          <h2 className="font-semibold text-base mb-2">4. How We Use Your Information</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>To provide and operate the Service</li>
            <li>To send account-related emails (password reset, billing confirmations)</li>
            <li>To improve the Service based on aggregated, anonymized usage patterns</li>
            <li>To comply with legal obligations</li>
          </ul>
          <p className="mt-2">We do not sell, rent, or share your personal information with third parties for marketing purposes.</p>
        </section>

        <section>
          <h2 className="font-semibold text-base mb-2">5. Data Storage and Security</h2>
          <p>Your data is stored on servers hosted by Railway (railway.app) in the United States. We use industry-standard encryption (TLS/HTTPS) for all data in transit. Account passwords are hashed using bcrypt before storage. We implement reasonable technical and organizational measures to protect your data, though no system is 100% secure.</p>
        </section>

        <section>
          <h2 className="font-semibold text-base mb-2">6. Third-Party Services</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Stripe</strong> - Payment processing. Subject to <a href="https://stripe.com/privacy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Stripe's Privacy Policy</a></li>
            <li><strong>Railway</strong> - Server hosting. Subject to <a href="https://railway.app/legal/privacy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Railway's Privacy Policy</a></li>
            <li><strong>Resend</strong> - Transactional email delivery</li>
          </ul>
        </section>

        <section>
          <h2 className="font-semibold text-base mb-2">7. Data Retention</h2>
          <p>We retain your account and study data for as long as your account is active. After cancellation, your data is retained for 2 years to align with common laboratory record retention requirements. During this period you can reactivate your account and regain full access to your historical records. After the 2-year period your account and associated data are permanently deleted, and we will notify you by email before this occurs. You may request earlier deletion at any time by emailing us; we will confirm deletion within 30 days, except where retention is required by law.</p>
        </section>

        <section>
          <h2 className="font-semibold text-base mb-2">8. Your Rights</h2>
          <p>You may request access to, correction of, or deletion of your personal data at any time by contacting us. We will respond within 30 days. If you are located in the EU/EEA, you have additional rights under GDPR including the right to data portability and the right to lodge a complaint with a supervisory authority.</p>
        </section>

        <section>
          <h2 className="font-semibold text-base mb-2">9. Cookies</h2>
          <p>VeritaCheck™ does not use tracking cookies. We use browser localStorage solely to maintain your login session. We do not use advertising cookies or third-party analytics trackers.</p>
        </section>

        <section>
          <h2 className="font-semibold text-base mb-2">10. Children's Privacy</h2>
          <p>The Service is intended for professional use by adults. We do not knowingly collect information from anyone under 18 years of age.</p>
        </section>

        <section>
          <h2 className="font-semibold text-base mb-2">11. Changes to This Policy</h2>
          <p>We may update this Privacy Policy periodically. We will notify registered users by email of material changes. The effective date at the top of this page reflects the most recent revision.</p>
        </section>

        <section>
          <h2 className="font-semibold text-base mb-2">12. Contact</h2>
          <p>Privacy questions or data requests: <a href="mailto:info@veritaslabservices.com" className="text-primary hover:underline">info@veritaslabservices.com</a><br />Veritas Lab Services, LLC · Upton, Massachusetts</p>
        </section>

      </div>
    </div>
  );
}
