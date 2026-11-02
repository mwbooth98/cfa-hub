// Supabase connection for the CFA Study Hub.
// These two values are safe to publish: the database's row-level security
// means only your signed-in account can read or change your data.
// Never put the service_role / secret key here.
window.CFA_CONFIG = {
  url: "PASTE_SUPABASE_PROJECT_URL",
  key: "PASTE_SUPABASE_ANON_OR_PUBLISHABLE_KEY"
};
