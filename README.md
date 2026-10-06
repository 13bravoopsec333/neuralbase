# Neuralbase

Static front end for Neuralbase, a cognitive-training web app. No build step.

- `/` redirects to the landing page
- `/app/landing.html` marketing page
- `/app/auth.html` sign up and sign in
- `/app/index.html` the app itself

Backend is Supabase. The only key in this repo is the public anon key, which is
designed to be shipped to browsers; row-level security is what protects data.
