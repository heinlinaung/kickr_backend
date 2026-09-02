#!/usr/bin/env node
/**
 * Sends one push to a token, using the same credentials and the same SDK calls
 * as PushService. Deliberately does NOT go through the API, so a failure here
 * means Firebase, and a failure there means our code.
 *
 *   node webpush-test/send.js <fcm-token>
 *
 * Run from the repo root — it reads .env from the current directory.
 */
require('dotenv').config({ quiet: true });
const { cert, getApps, initializeApp } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');

const token = process.argv[2];
if (!token) {
  console.error('Usage: node webpush-test/send.js <fcm-token>');
  console.error('Get the token from the web page at http://localhost:8080');
  process.exit(1);
}

const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } =
  process.env;
if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
  console.error('Missing FIREBASE_* env vars — is .env present?');
  process.exit(1);
}

(async () => {
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId: FIREBASE_PROJECT_ID,
        clientEmail: FIREBASE_CLIENT_EMAIL,
        privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
    });
  }

  try {
    // Mirrors what NotificationsService sends: notification + string-only data.
    const id = await getMessaging().send({
      token,
      notification: {
        title: 'Teams are ready',
        body: 'Friday five — check your team and get ready to play.',
      },
      data: { type: 'event', refId: '68b0aa11bb22cc33dd44ee55' },
      webpush: {
        notification: { title: 'Teams are ready', body: 'Web push works.' },
      },
    });
    console.log('SENT  ✓  message id:', id);
    console.log('Expect an OS notification if the tab is backgrounded, or a');
    console.log('FOREGROUND PUSH line in the page log if it is focused.');
  } catch (err) {
    console.log('FAILED  ✗ ', err.code);
    console.log(err.message);
    const hints = {
      'messaging/registration-token-not-registered':
        'Token is stale — reload the page and get a fresh one.',
      'messaging/invalid-argument':
        'Token is malformed. Copy the whole string; it is ~160 chars.',
      'messaging/mismatched-credential':
        'Token belongs to a different Firebase project than the service account.',
    };
    if (hints[err.code]) console.log('\nHint:', hints[err.code]);
  }
})();
