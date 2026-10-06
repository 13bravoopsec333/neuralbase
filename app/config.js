/* Neuralbase v2 config.
   Fill SUPABASE_URL and SUPABASE_ANON_KEY from your Supabase project (Project settings -> API).
   Only the anon / publishable key belongs in the browser. Never put the service_role or
   sb_secret_ key in this file: it is served to every visitor and is a full database compromise.
   While these are empty the app runs in demo mode (localStorage only, no network).

   The anon key is public by design: it ships to every browser and RLS is what actually
   protects the data. This file is safe to commit with these two values filled in. */

export const SUPABASE_URL = "https://gmuyfbisgvszgigemsxe.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdtdXlmYmlzZ3ZzemdpZ2Vtc3hlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEzMDc2OTYsImV4cCI6MjEwNjg4MzY5Nn0.HE5NBxFPdZ-Y69eQqXmv1z5m6PjXaaWdiGEdjCQbu6Y";
export const DEMO = !SUPABASE_URL || !SUPABASE_ANON_KEY;
