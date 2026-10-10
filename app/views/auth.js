/* Neuralbase v2 auth view.
   One page, two modes (sign in / create account), plus a profile-completion step
   for Google sign-ins, which carry no date of birth.
   All auth goes through the frozen lib/auth.js envelope API, so nothing here throws. */

import { isDemo } from '../lib/supabase.js';
import {
  signUp,
  signIn,
  signInWithGoogle,
  saveProfile,
  ageOk,
  MIN_AGE,
  getSession,
  verifySignupCode,
  resendSignupCode,
} from '../lib/auth.js';

const $ = (id) => document.getElementById(id);

const SIGNUP_FIELDS = ['su-email', 'su-password', 'su-username', 'su-dob'];
const SIGNIN_FIELDS = ['si-email', 'si-password'];
const COMPLETE_FIELDS = ['co-username', 'co-dob'];
const VERIFY_FIELDS = ['vf-code'];

/* ---------------- validation (client side, matches the server rules) ---------------- */

const emailOk = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const usernameOk = (v) => /^[A-Za-z0-9_]{3,24}$/.test(v);
const passwordOk = (v) => typeof v === 'string' && v.length >= 8;

function val(id) {
  const el = $(id);
  return el ? String(el.value || '').trim() : '';
}

function setErr(id, msg) {
  const input = $(id);
  const err = $(id + '-err');
  if (input) input.setAttribute('aria-invalid', 'true');
  if (err) err.textContent = msg;
}

function clearFields(ids) {
  ids.forEach((id) => {
    const input = $(id);
    const err = $(id + '-err');
    if (input) input.removeAttribute('aria-invalid');
    if (err) err.textContent = '';
  });
}

/* ---------------- alerts and status ---------------- */

function setAlert(id, msg, ok) {
  const el = $(id);
  if (!el) return;
  if (!msg) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.hidden = false;
  el.textContent = msg;
  el.classList.toggle('ok', !!ok);
}

function clearAlerts() {
  ['si-alert', 'su-alert', 'co-alert', 'vf-alert'].forEach((id) => setAlert(id, ''));
}

function announce(msg) {
  const live = $('live');
  if (live) live.textContent = msg;
}

function busy(id, on, label) {
  const btn = $(id);
  if (!btn) return;
  btn.disabled = on;
  btn.setAttribute('aria-busy', on ? 'true' : 'false');
  if (on) {
    btn.dataset.label = btn.textContent;
    btn.textContent = label || 'Working...';
  } else if (btn.dataset.label) {
    btn.textContent = btn.dataset.label;
  }
}

/* Turn a raw Supabase or lib error string into something a person can act on. */
function friendly(error) {
  const s = String(error == null ? '' : error);
  /* Supabase answers a signup for an address that already has an account with
     "User already registered", which is an enumeration oracle: it turns the signup
     form into a way to ask whether a given person has an account here. The address
     is never named back, and the answer is the same shape as every other signup
     refusal, so the form no longer confirms that the account exists. The two
     actions a person can take are still both offered below the form. */
  if (/signup_unavailable|already registered|already been registered|user already/i.test(s)) {
    return 'Check the address and password, then try again. If you already have an account, sign in.';
  }
  if (/23505|duplicate|unique|username is taken/i.test(s)) {
    return 'That username is taken. Try another.';
  }
  if (/invalid_dob/i.test(s)) {
    return 'That date of birth was not accepted. Check the format.';
  }
  if (/rate limit|too many/i.test(s)) {
    return 'Too many attempts. Wait a minute and try again.';
  }
  if (/invalid login credentials/i.test(s)) {
    return 'Email or password is incorrect.';
  }
  return s || 'Something went wrong. Try again.';
}

/* The same person, mid-signup: Supabase refuses the password sign-in until the email
   is confirmed. Matched on the stable code or message, never on a whole sentence, so
   a wrong password (a different error) still reads as a wrong password. */
function isUnconfirmed(error) {
  const s = String(error == null ? '' : error);
  return /email_not_confirmed|email not confirmed/i.test(s);
}

function isRateLimit(error) {
  const s = String(error == null ? '' : error);
  return /rate limit|too many|security purposes|429/i.test(s);
}

/* Verify and resend errors, in the person's words. The raw Supabase string is never
   shown: the fallback is a plain sentence, not the server text. */
function verifyFriendly(error) {
  const s = String(error == null ? '' : error);
  if (/not_available_in_demo/i.test(s)) {
    return 'Verification is not available in demo mode.';
  }
  if (/otp_expired|expired/i.test(s)) {
    return 'That code has expired. Send a new one and try again.';
  }
  if (isRateLimit(s)) {
    return 'Too many emails just now. Wait a minute, then try again.';
  }
  if (/invalid|incorrect|not valid|otp/i.test(s)) {
    return 'That code is not right. Check the email and try again.';
  }
  return 'That code did not work. Check the email and try again.';
}

/* ---------------- screen changes ---------------- */

function go() {
  location.assign('index.html');
}

function needsCompletion(user) {
  const meta = (user && user.user_metadata) || {};
  return !meta.username || !meta.dob;
}

/* ---------------- modes ---------------- */

const PANELS = {
  signin: 'panel-signin',
  signup: 'panel-signup',
};

function setMode(mode) {
  const m = mode === 'signup' ? 'signup' : 'signin';
  $('tabs').dataset.mode = m;
  const si = $('tab-signin');
  const su = $('tab-signup');
  si.setAttribute('aria-selected', m === 'signin' ? 'true' : 'false');
  su.setAttribute('aria-selected', m === 'signup' ? 'true' : 'false');
  si.tabIndex = m === 'signin' ? 0 : -1;
  su.tabIndex = m === 'signup' ? 0 : -1;
  $('panel-signin').hidden = m !== 'signin';
  $('panel-signup').hidden = m !== 'signup';
  $('panel-complete').hidden = true;
  $('panel-verify').hidden = true;
  $('tabs').hidden = false;
  stopResendCooldown();
  clearAlerts();
}

function showComplete(user) {
  $('tabs').hidden = true;
  $('panel-signin').hidden = true;
  $('panel-signup').hidden = true;
  $('panel-verify').hidden = true;
  $('panel-complete').hidden = false;
  const meta = (user && user.user_metadata) || {};
  if (meta.username && !$('co-username').value) $('co-username').value = meta.username;
  stopResendCooldown();
  clearAlerts();
  $('co-username').focus();
}

/* The confirmation step, in the same shape as showComplete: the tabs go away and one
   panel takes their place. The address is the one the link went to, so the person can
   see it and go back if it is wrong. The code field stays folded away: on this plan
   the email carries a link, and the code is only there for when it does not. */
let pendingEmail = '';

function showVerify(email) {
  pendingEmail = String(email == null ? '' : email).trim();
  $('tabs').hidden = true;
  $('panel-signin').hidden = true;
  $('panel-signup').hidden = true;
  $('panel-complete').hidden = true;
  $('panel-verify').hidden = false;
  $('vf-email').textContent = pendingEmail;
  $('vf-code-box').open = false;
  clearAlerts();
  clearFields(VERIFY_FIELDS);
  if ($('vf-code')) $('vf-code').value = '';
  stopResendCooldown();
  $('vf-title').focus();
}

/* ---------------- resend cooldown ---------------- */

/* Supabase rate limits confirmation emails, so the button rests between sends. The
   clock is a deadline, not a decrement, so a throttled background tab still shows the
   true wait. It is a client guard: the server limit is not readable from here, and a
   send that the server still refuses comes back as a rate limit message. */
const RESEND_WAIT = 60;
let resendUntil = 0;
let resendTimer = null;

function resendLeft() {
  return Math.max(0, Math.ceil((resendUntil - Date.now()) / 1000));
}

function paintResend() {
  const btn = $('vf-resend');
  const note = $('vf-resend-note');
  if (!btn) return;
  const left = resendLeft();
  btn.disabled = left > 0;
  if (note) {
    note.hidden = left <= 0;
    note.textContent = left > 0 ? 'You can resend in ' + left + 's.' : '';
  }
}

function startResendCooldown(seconds) {
  resendUntil = Date.now() + (seconds > 0 ? seconds : RESEND_WAIT) * 1000;
  if (resendTimer) clearInterval(resendTimer);
  paintResend();
  resendTimer = setInterval(() => {
    if (resendLeft() <= 0) {
      clearInterval(resendTimer);
      resendTimer = null;
    }
    paintResend();
  }, 1000);
}

function stopResendCooldown() {
  if (resendTimer) clearInterval(resendTimer);
  resendTimer = null;
  resendUntil = 0;
  paintResend();
}

/* A verified or freshly created session finishes the same way either time: complete
   the profile if the metadata is thin, otherwise go. */
function finish(res) {
  const user = (res && res.user) || (res && res.session && res.session.user) || null;
  if (!isDemo() && needsCompletion(user)) {
    showComplete(user);
    return;
  }
  go();
}

/* ---------------- submit handlers ---------------- */

async function onSignin(event) {
  event.preventDefault();
  clearFields(SIGNIN_FIELDS);
  setAlert('si-alert', '');
  const email = val('si-email');
  const password = $('si-password').value;

  let bad = false;
  if (!emailOk(email)) {
    setErr('si-email', 'Enter a valid email address.');
    bad = true;
  }
  if (!password) {
    setErr('si-password', 'Enter your password.');
    bad = true;
  }
  if (bad) return;

  busy('si-submit', true, 'Signing in...');
  const res = await signIn(email, password);
  busy('si-submit', false);

  if (!res.ok) {
    /* An unconfirmed account is the same person mid-signup, so send them to the code
       step rather than a wall of text on the sign-in form. */
    if (isUnconfirmed(res.error)) {
      showVerify(email);
      setAlert('vf-alert', 'That email is not confirmed yet. Open the link we sent, or resend it.');
      announce('Email not confirmed. Open the confirmation link.');
      return;
    }
    setAlert('si-alert', friendly(res.error));
    announce('Sign in failed.');
    return;
  }
  finish(res);
}

async function onSignup(event) {
  event.preventDefault();
  clearFields(SIGNUP_FIELDS);
  setAlert('su-alert', '');
  const email = val('su-email');
  const password = $('su-password').value;
  const username = val('su-username');
  const dob = val('su-dob');

  let bad = false;
  if (!emailOk(email)) {
    setErr('su-email', 'Enter a valid email address.');
    bad = true;
  }
  if (!passwordOk(password)) {
    setErr('su-password', 'Password must be at least 8 characters.');
    bad = true;
  }
  if (!usernameOk(username)) {
    setErr('su-username', 'Use 3 to 24 letters, numbers, or _.');
    bad = true;
  }
  if (!dob) {
    setErr('su-dob', 'Enter your date of birth.');
    bad = true;
  } else if (!ageOk(dob)) {
    setErr('su-dob', 'You must be ' + MIN_AGE + ' or older to create an account.');
    bad = true;
  }
  if (bad) return;

  busy('su-submit', true, 'Creating account...');
  const res = await signUp({ email, password, username, dob });
  busy('su-submit', false);

  if (!res.ok) {
    setAlert('su-alert', friendly(res.error));
    announce('Account creation failed.');
    return;
  }
  if (res.session) {
    finish(res);
    return;
  }
  /* Email confirmation is on: Supabase sent the link and holds the session until it
     is opened. Stay on this page and say so. */
  showVerify(email);
  startResendCooldown();
  announce('Account created. Open the confirmation link sent to ' + email + '.');
}

async function onVerify(event) {
  event.preventDefault();
  clearFields(VERIFY_FIELDS);
  setAlert('vf-alert', '');
  const code = val('vf-code');

  if (!/^\d{6}$/.test(code)) {
    setErr('vf-code', 'Enter the 6 digit code from the email.');
    return;
  }

  busy('vf-submit', true, 'Verifying...');
  const res = await verifySignupCode({ email: pendingEmail, token: code });
  busy('vf-submit', false);

  if (!res.ok) {
    setAlert('vf-alert', verifyFriendly(res.error));
    announce('That code did not work.');
    return;
  }
  finish(res);
}

async function onResend() {
  if (resendLeft() > 0) return;
  setAlert('vf-alert', '');
  busy('vf-resend', true, 'Sending...');
  const res = await resendSignupCode({ email: pendingEmail });
  busy('vf-resend', false);

  if (!res.ok) {
    /* The server refused, usually its own rate limit. Hold the button for the wait it
       names when it names one, otherwise the client guard's own wait. */
    const m = /(\d+)\s*seconds?/i.exec(String(res.error == null ? '' : res.error));
    if (isRateLimit(res.error)) startResendCooldown(m ? Number(m[1]) : RESEND_WAIT);
    setAlert('vf-alert', verifyFriendly(res.error));
    announce('Could not send a new code.');
    return;
  }
  setAlert('vf-alert', 'A new email was sent to ' + pendingEmail + '.', true);
  startResendCooldown();
  announce('A new email was sent.');
}

async function onComplete(event) {
  event.preventDefault();
  clearFields(COMPLETE_FIELDS);
  setAlert('co-alert', '');
  const username = val('co-username');
  const dob = val('co-dob');

  let bad = false;
  if (!usernameOk(username)) {
    setErr('co-username', 'Use 3 to 24 letters, numbers, or _.');
    bad = true;
  }
  if (!dob) {
    setErr('co-dob', 'Enter your date of birth.');
    bad = true;
  } else if (!ageOk(dob)) {
    setErr('co-dob', 'You must be ' + MIN_AGE + ' or older.');
    bad = true;
  }
  if (bad) return;

  busy('co-submit', true, 'Saving...');
  const res = await saveProfile({ username, dob });
  busy('co-submit', false);

  if (!res.ok) {
    setAlert('co-alert', friendly(res.error));
    return;
  }
  go();
}

async function onGoogle() {
  clearAlerts();
  const res = await signInWithGoogle();
  if (!res.ok) {
    setAlert($('panel-signup').hidden ? 'si-alert' : 'su-alert', friendly(res.error));
    return;
  }
  if (isDemo()) {
    /* No network in demo: the lib returns a local session straight away. */
    go();
    return;
  }
  /* Real OAuth: the browser goes to Google, then back to the app. */
  if (res.user && needsCompletion(res.user)) showComplete(res.user);
  else if (res.user) go();
}

async function onDemoContinue() {
  clearAlerts();
  busy('demoContinue', true, 'Starting...');
  const res = await signIn('demo@local', 'demo');
  busy('demoContinue', false);
  if (!res.ok) {
    setAlert('si-alert', friendly(res.error));
    return;
  }
  go();
}

/* ---------------- boot ---------------- */

function wire() {
  const today = new Date().toISOString().slice(0, 10);
  ['su-dob', 'co-dob'].forEach((id) => {
    const el = $(id);
    if (el) el.max = today;
  });

  $('signinForm').addEventListener('submit', onSignin);
  $('signupForm').addEventListener('submit', onSignup);
  $('completeForm').addEventListener('submit', onComplete);
  $('verifyForm').addEventListener('submit', onVerify);
  $('si-google').addEventListener('click', onGoogle);
  $('su-google').addEventListener('click', onGoogle);
  $('demoContinue').addEventListener('click', onDemoContinue);

  $('vf-resend').addEventListener('click', onResend);

  /* Back to sign in carries the address they were verifying, so they are not asked
     to retype it. */
  $('vf-back').addEventListener('click', () => {
    const si = $('si-email');
    if (si && !si.value && pendingEmail) si.value = pendingEmail;
  });

  /* One field, not six boxes: a 6 digit code is one value, the browser's one-time-code
     autofill fills a single input, and there is no focus juggling to get wrong. Typing
     is filtered to digits; a paste is read for its digits instead, and a paste with
     none says so rather than quietly emptying the field. */
  const codeInput = $('vf-code');
  codeInput.addEventListener('input', () => {
    const digits = codeInput.value.replace(/\D/g, '').slice(0, 6);
    if (digits !== codeInput.value) codeInput.value = digits;
    if (digits) {
      codeInput.removeAttribute('aria-invalid');
      const err = $('vf-code-err');
      if (err) err.textContent = '';
    }
  });
  codeInput.addEventListener('paste', (event) => {
    const text = (event.clipboardData && event.clipboardData.getData('text')) || '';
    event.preventDefault();
    const digits = String(text).replace(/\D/g, '').slice(0, 6);
    if (!digits) {
      setErr('vf-code', 'The code is 6 digits, numbers only.');
      return;
    }
    codeInput.value = digits;
    codeInput.removeAttribute('aria-invalid');
    const err = $('vf-code-err');
    if (err) err.textContent = '';
    codeInput.focus();
  });

  $('tab-signin').addEventListener('click', () => setMode('signin'));
  $('tab-signup').addEventListener('click', () => setMode('signup'));

  document.querySelectorAll('[data-goto]').forEach((btn) => {
    btn.addEventListener('click', () => setMode(btn.dataset.goto));
  });

  /* Arrow keys move between the two tabs. */
  $('tabs').addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const next = $('tabs').dataset.mode === 'signup' ? 'signin' : 'signup';
    setMode(next);
    $(next === 'signup' ? 'tab-signup' : 'tab-signin').focus();
  });

  if (isDemo()) $('demoBanner').hidden = false;
}

/* A confirmation link lands here with tokens in the hash, and Supabase's
   detectSessionInUrl turns them into a session. An expired or already used link lands
   with an error in the hash instead. Read it before getSession, because the client
   cleans the URL as it consumes it. */
function readUrlAuth() {
  const hash = String(location.hash || '');
  if (hash.length < 2) return null;
  const p = new URLSearchParams(hash.slice(1));
  const err = p.get('error_description') || p.get('error_code') || p.get('error');
  const token = p.get('access_token');
  if (!err && !token) return null;
  return { kind: err ? 'error' : 'session', text: err ? String(err) : '' };
}

function linkMessage(link) {
  const s = String((link && link.text) || '');
  if (/expired|invalid|already|otp_expired/i.test(s)) {
    return 'That confirmation link has expired or was already used. Sign in to get a new one.';
  }
  return 'That confirmation link did not work. Sign in with your email and password to try again.';
}

async function boot() {
  wire();
  const link = readUrlAuth();
  let res = null;
  try {
    res = await getSession();
  } catch (e) {
    /* Stay on the form if the session check fails. */
  }
  if (link) {
    /* The client has read the hash by now; drop it so a refresh does not replay it. */
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* best effort */ }
  }
  const user = res && res.session && res.session.user;
  if (user && !isDemo()) {
    finish({ user });
    return;
  }
  if (link && link.kind === 'error') {
    setAlert('si-alert', linkMessage(link));
    announce(linkMessage(link));
    return;
  }
  if (link && link.kind === 'session') {
    /* Tokens were in the URL but no session came back, so the link did not finish. */
    setAlert('si-alert', 'That confirmation link did not finish signing you in. Sign in with your email and password.');
    announce('The confirmation link did not sign you in.');
  }
}

boot();
