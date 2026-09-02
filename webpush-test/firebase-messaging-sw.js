// Service worker for FCM web push.
//
// MUST be served from the site root (/firebase-messaging-sw.js) — the FCM SDK
// looks for it there by default, and a worker can only control pages at or
// below its own path.
//
// Uses the compat build because a service worker cannot use ES modules in all
// browsers, and compat is what Firebase's own web-push docs use here.
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts(
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js',
);

// Injected by index.html via the query string so there is one place to edit
// config. Falls back to nothing, in which case init throws visibly.
const params = new URL(self.location).searchParams;
const config = {
  apiKey: params.get('apiKey'),
  projectId: params.get('projectId'),
  messagingSenderId: params.get('messagingSenderId'),
  appId: params.get('appId'),
};

firebase.initializeApp(config);
const messaging = firebase.messaging();

// Fires only when the page is NOT in the foreground. Foreground messages are
// handled by onMessage in index.html instead — that split is FCM's design, and
// forgetting it is why "push works but nothing shows" while the tab is open.
messaging.onBackgroundMessage((payload) => {
  const n = payload.notification || {};
  self.registration.showNotification(n.title || 'KickR', {
    body: n.body || '',
    data: payload.data || {},
  });
});
