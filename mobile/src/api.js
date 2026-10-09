const BASE_URL = 'https://saldo-slim-api.onrender.com';
let authToken = null;

async function request(path, options = {}) {
  const headers = { Accept: 'application/json', ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}), ...(options.headers || {}) };
  let response;
  try {
    response = await fetch(`${BASE_URL}${path}`, { ...options, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  } catch (_) {
    throw new Error('Kan de server niet bereiken. Controleer je internetverbinding en probeer opnieuw.');
  }
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch (_) { data = { message: text }; }
  }
  if (!response.ok) {
    const message = data?.message || data?.error || `Verzoek mislukt (${response.status}).`;
    throw new Error(message);
  }
  return data;
}
const post = (path, body) => request(path, { method: 'POST', body });
const get = (path) => request(path, { method: 'GET' });

const api = {
  baseUrl: BASE_URL,
  setToken(token) { authToken = token || null; },
  login(credentials) { return post('/auth/login', credentials); },
  register(details) { return post('/auth/register', details); },
  passwordHelp(email) { return post('/auth/password-help', { email }); },
  getMe() { return get('/me'); },
  updateFinancialProfile(profile) { return request('/financial-profile', { method: 'PUT', body: profile }); },
  sendSupport(payload) { return post('/support', payload); },
  getAdminOverview() { return get('/admin/overview'); },
  getAdminUsers() { return get('/admin/users'); },
  getAdminSubscriptions() { return get('/admin/subscriptions'); },
  getAdminPayouts() { return get('/admin/payouts'); },
  getAdminSupport() { return get('/admin/support'); },
  getAdminAudit() { return get('/admin/audit'); },
  setAdminUserRole(id, payload) { return post(`/admin/users/${encodeURIComponent(id)}/role`, payload); },
  setAdminUserStatus(id, payload) { return post(`/admin/users/${encodeURIComponent(id)}/status`, payload); },
  setAdminSupportStatus(id, payload) { return post(`/admin/support/${encodeURIComponent(id)}/status`, payload); },
  cancelAdminSubscription(id, payload = {}) { return post(`/admin/subscriptions/${encodeURIComponent(id)}/cancel`, payload); }
};

export default api;
