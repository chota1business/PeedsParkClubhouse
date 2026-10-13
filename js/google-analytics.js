// Track public production pages only; staging, previews and staff pages are excluded.
(() => {
  if (!['peedspark.com', 'www.peedspark.com'].includes(window.location.hostname) || window.location.pathname.includes('/admin-v2/')) return;
  if (window.peedsParkAnalyticsLoaded) return;
  window.peedsParkAnalyticsLoaded = true;
  const measurementId = 'G-PMVRG1TGW7';
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  // Do not include query strings or fragments, which may contain booking information.
  window.gtag('config', measurementId, {
    page_location: window.location.origin + window.location.pathname,
    allow_google_signals: false,
    allow_ad_personalization_signals: false
  });
  const script = document.createElement('script');
  script.async = true;
  script.src = 'https://www.googletagmanager.com/gtag/js?id=' + measurementId;
  document.head.append(script);
})();
