type GA4EventName = 'begin_checkout' | 'select_item' | 'sign_up' | 'purchase' | 'invoice_request_submitted' | 'invoice_request_cta_click' | 'invoice_request_card_link_click';

interface GA4EventParams {
  // begin_checkout / purchase / select_item
  currency?: string;
  value?: number;
  transaction_id?: string;
  items?: Array<{
    item_id: string;
    item_name: string;
    price?: number;
    quantity?: number;
  }>;
  // select_item
  item_list_id?: string;
  item_list_name?: string;
  // sign_up
  method?: string;
  // invoice_request_submitted
  tier?: string;
  seats?: number;
  has_promo?: boolean;
}

export function trackEvent(name: GA4EventName, params: GA4EventParams = {}) {
  if (typeof window === 'undefined') return;
  const w = window as any;
  if (typeof w.gtag !== 'function') return;
  try {
    w.gtag('event', name, params);
  } catch (e) {
    // never let analytics break the user flow
    console.warn('GA4 event failed:', e);
  }
}
