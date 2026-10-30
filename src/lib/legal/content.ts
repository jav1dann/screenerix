/**
 * Legal pages (English). Drafted templates: text in [square brackets] is a placeholder the
 * operator must fill in (and have reviewed by a lawyer) before launch — the page highlights it.
 */
export type LegalBlock = string | { list: string[] } | { table: { head: string[]; rows: string[][] } };
export interface LegalSection { id: string; heading: string; body: LegalBlock[] }
export interface LegalDoc { slug: string; title: string; description: string; updated: string; intro: string; sections: LegalSection[] }

const UPDATED = '24 October 2026';
const ENTITY = 'Screenerix';
const CONTACT = 'support@screenerix.com';
const ADDRESS = 'Baku, Azerbaijan';

export const PRIVACY: LegalDoc = {
  slug: 'privacy',
  title: 'Privacy Policy',
  description: 'What personal data Screenerix collects, why, and the choices you have.',
  updated: UPDATED,
  intro: `This policy explains how ${ENTITY} ("we") handles personal data when you use the Screenerix website and trading terminal (the "Service"). We collect as little as we need to run the Service.`,
  sections: [
    { id: 'controller', heading: 'Who is responsible', body: [
      `${ENTITY}, ${ADDRESS}, is the controller of your personal data. Contact: ${CONTACT}.`,
    ] },
    { id: 'data', heading: 'Data we collect', body: [
      { list: [
        'Account data: your name, email address and a salted hash of your password (we never store the password itself).',
        'Google sign-in: if you choose it, Google shares your name, email address, Google account ID and profile picture. We do not receive your Google password.',
        'Settings you save in the terminal, such as layouts, watchlists, filters and alerts. Most of these stay in your browser’s local storage.',
        'Technical data needed for security: IP address and request metadata in short-lived server logs, used to prevent abuse (for example, repeated failed sign-ins).',
        'Billing data: payments are handled by our payment provider, NOWPayments. We receive only the order ID, amount, payment status and the on-chain transaction; we never receive or store your wallet’s private keys or seed phrase.',
      ] },
      'Screenerix does not ask for exchange account keys and does not access your exchange funds. Market data shown in the terminal comes from public exchange feeds.',
    ] },
    { id: 'use', heading: 'How we use it', body: [
      { list: [
        'To create and secure your account and keep you signed in (performance of our contract with you).',
        'To provide the features you use, including delivering alerts to the browser or Telegram when you connect it (contract).',
        'To prevent fraud and abuse and keep the Service secure (legitimate interest).',
        'To send service messages about your account, trial or subscription (contract). We do not send marketing email without your consent.',
      ] },
      'We do not sell your personal data and do not use it for advertising profiles.',
    ] },
    { id: 'sharing', heading: 'Who we share it with', body: [
      'We share data only with providers that help us run the Service, under contracts that protect it: hosting (InterServer), sign-in (Google, if you use it), messaging (Telegram, if you connect alerts) and crypto payments (NOWPayments, which receives your order ID, amount and the paying wallet’s on-chain transaction). We may disclose data if the law requires it.',
    ] },
    { id: 'retention', heading: 'How long we keep it', body: [
      'Account data is kept while your account exists and deleted within [30] days after you delete it, except where the law requires longer retention (for example, invoices). Security logs are kept for up to [30] days.',
    ] },
    { id: 'rights', heading: 'Your rights', body: [
      `Depending on where you live, you can ask to access, correct, export or delete your data, object to or restrict processing, and withdraw consent. Write to ${CONTACT}. You may also complain to your local data protection authority.`,
    ] },
    { id: 'transfers', heading: 'International transfers', body: [
      'Our providers may process data outside your country. Where required, we rely on appropriate safeguards such as standard contractual clauses.',
    ] },
    { id: 'children', heading: 'Children', body: [
      'The Service is not intended for anyone under 18, and we do not knowingly collect their data.',
    ] },
    { id: 'changes', heading: 'Changes', body: [
      'We will post any update on this page and change the date above. Material changes will be announced in the terminal or by email.',
    ] },
  ],
};

export const TERMS: LegalDoc = {
  slug: 'terms',
  title: 'Terms of Service',
  description: 'The agreement between you and Screenerix for using the website and terminal.',
  updated: UPDATED,
  intro: `These Terms of Service (the "Terms") form the user agreement between you and ${ENTITY} for the Screenerix website and trading terminal (the "Service"). By creating an account or using the Service you accept these Terms.`,
  sections: [
    { id: 'service', heading: 'The Service', body: [
      'Screenerix is a market data and analytics tool for crypto assets: market maps, screeners, order book densities, charts and alerts built on public exchange data. Screenerix is not an exchange or a broker. It does not execute trades, hold funds or connect to your exchange accounts.',
    ] },
    { id: 'advice', heading: 'No financial advice', body: [
      'Everything shown in the Service is information, not investment, financial, legal or tax advice. Trading crypto assets is highly risky and you can lose all the money you trade. You alone are responsible for your trading decisions.',
    ] },
    { id: 'data', heading: 'Market data', body: [
      'Market data comes from third-party exchanges and is provided "as is". It may be delayed, incomplete or wrong, and exchanges may change or interrupt their feeds. Alerts depend on your browser, network and third-party services such as Telegram, and may arrive late or not at all. Do not rely on the Service as your only source of information.',
    ] },
    { id: 'account', heading: 'Your account', body: [
      { list: [
        'You must be at least 18 and give accurate account information.',
        'Keep your credentials secure. You are responsible for activity under your account.',
        'One account is for one person. Do not share or resell access.',
      ] },
    ] },
    { id: 'plans', heading: 'Trial, plans and payment', body: [
      'New accounts get a 3-day free trial with full access, without a credit card. After the trial, continued access requires the Pro plan, bought for one month or one year at the prices shown on the website. Pro is paid in USDT through our payment provider (NOWPayments) as a one-time payment per period: it does not renew automatically, and a new payment extends your plan from its current end date. A payment counts once it is confirmed on the blockchain for the full amount, on the network chosen at checkout. You are responsible for sending the right token on the right network to the address shown; funds sent otherwise may be lost. Refunds are covered by our Refund Policy.',
    ] },
    { id: 'use', heading: 'Acceptable use', body: [
      { list: [
        'Do not scrape, copy or redistribute data or content from the Service, or build a competing product from it.',
        'Do not overload, probe or interfere with the Service, or try to bypass access controls.',
        'Do not use the Service for anything unlawful, including market manipulation.',
      ] },
      'We may suspend or close accounts that break these rules.',
    ] },
    { id: 'ip', heading: 'Intellectual property', body: [
      'The Service, its software and design belong to Screenerix and its licensors. We give you a personal, non-transferable licence to use the Service while your account is active.',
    ] },
    { id: 'liability', heading: 'Disclaimers and liability', body: [
      'The Service is provided "as is" and "as available", without warranties of uninterrupted or error-free operation. To the extent the law allows, Screenerix is not liable for trading losses, lost profits or indirect damages, and our total liability is limited to the amount you paid us in the 12 months before the claim.',
    ] },
    { id: 'termination', heading: 'Termination', body: [
      'You can stop using the Service and delete your account at any time. We may end or suspend access if you breach these Terms, with notice where reasonable.',
    ] },
    { id: 'law', heading: 'Governing law', body: [
      `These Terms are governed by the laws of the Republic of Azerbaijan, and disputes go to the courts of ${ADDRESS}, unless the consumer law of your country gives you other rights.`,
    ] },
    { id: 'changes', heading: 'Changes and contact', body: [
      `We may update these Terms and will post the new version here. If a change is material, we will notify you in advance. Questions: ${CONTACT}.`,
    ] },
  ],
};

export const REFUNDS: LegalDoc = {
  slug: 'refunds',
  title: 'Refund Policy',
  description: 'How the free trial, cancellations and refunds work for Screenerix Pro.',
  updated: UPDATED,
  intro: 'We want you to pay only for a terminal you actually use. That is why every account starts with a free trial.',
  sections: [
    { id: 'trial', heading: 'Free trial', body: [
      'Every new account gets 3 days of full access for free, with no credit card required. Nothing is charged when the trial ends.',
    ] },
    { id: 'cancel', heading: 'Cancelling', body: [
      'Pro is a one-time payment per month or year and never renews by itself, so there is nothing to cancel: your plan simply ends at the end of the period you paid for unless you pay again.',
    ] },
    { id: 'monthly', heading: 'Monthly plan ($8 / month)', body: [
      'Monthly payments are not refunded once the billing period has started, except where the law requires it or as described under "Service problems".',
    ] },
    { id: 'yearly', heading: 'Yearly plan ($80 / year)', body: [
      'You can request a full refund within [14] days of the first yearly payment. After that, yearly payments are not refunded, but you keep access until the end of the year.',
    ] },
    { id: 'crypto', heading: 'Crypto payments', body: [
      'Payments are made in USDT and are final once confirmed on the blockchain. Approved refunds are sent in USDT, on a network we agree with you, to a wallet address you give us, less the network fee; we cannot refund to the sending address of an exchange.',
      'Underpaid orders do not activate Pro until the remaining amount arrives at the same address. If you sent less than required, the wrong token or the wrong network, contact us with your order ID and we will try to help, but recovery is not always possible.',
    ] },
    { id: 'issues', heading: 'Service problems and duplicate charges', body: [
      'If you paid twice for the same order, or could not use the Service for an extended period because of a fault on our side, contact us and we will refund the affected amount.',
    ] },
    { id: 'how', heading: 'How to request a refund', body: [
      `Email ${CONTACT} from your account email with the order ID (shown on the Billing page) and the date of the payment. We answer within [5] business days, and approved refunds are sent within [5–10] business days.`,
      'Your statutory rights as a consumer, including any right of withdrawal in your country, are not affected.',
    ] },
  ],
};

export const COOKIES: LegalDoc = {
  slug: 'cookies',
  title: 'Cookie Policy',
  description: 'The cookies and browser storage Screenerix uses. No advertising or tracking cookies.',
  updated: UPDATED,
  intro: 'Screenerix uses only the cookies and browser storage needed to run the Service and remember your choices. We do not use advertising or third-party tracking cookies.',
  sections: [
    { id: 'cookies', heading: 'Cookies we set', body: [
      { table: {
        head: ['Name', 'Purpose', 'Duration'],
        rows: [
          ['sx_session', 'Keeps you signed in. HttpOnly and signed, so it cannot be read or changed by scripts.', 'Until you sign out, at most 7 days'],
          ['sx_oauth', 'Protects a Google sign-in in progress (security check between Google and Screenerix).', '10 minutes'],
          ['sx_lang', 'Remembers the language you chose for the website.', '1 year'],
        ],
      } },
      'These cookies are strictly necessary or store a choice you made, so they do not require consent under most cookie laws.',
    ] },
    { id: 'storage', heading: 'Browser storage', body: [
      'The terminal saves your preferences in your browser’s local storage: layouts, watchlists, filters, color rules, alerts and chart drawings. This data stays on your device and is not sent to us unless a feature needs it, such as delivering a Telegram alert.',
    ] },
    { id: 'third', heading: 'Third parties', body: [
      'If you sign in with Google, Google may set its own cookies on its pages under the Google Privacy Policy. Screenerix pages do not load third-party analytics or advertising scripts.',
    ] },
    { id: 'control', heading: 'Your choices', body: [
      'You can delete cookies and site data in your browser settings at any time. Deleting sx_session signs you out; clearing local storage resets your terminal preferences.',
      `Questions: ${CONTACT}.`,
    ] },
  ],
};

export const LEGAL_DOCS = [PRIVACY, TERMS, REFUNDS, COOKIES];
