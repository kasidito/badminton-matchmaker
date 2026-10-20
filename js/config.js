/* Public connection settings. The publishable key is safe to ship in the browser:
   row level security in the database decides what a signed-in admin can do. Never put the
   service_role key here. */
window.APP_CONFIG = {
  supabaseUrl: 'https://vhvlhuimelqsnglhayxs.supabase.co',
  supabaseKey: 'sb_publishable_6FJw1grb2MG0LjjkoDeKjg_WfqihrZu'
};
