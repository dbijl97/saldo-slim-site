const BASE_URL = 'https://saldo-slim-api.onrender.com';
let authToken = null;

function getDutchErrorMessage(status, data) {
  const messages = {
    400: 'Controleer de ingevulde gegevens en probeer het opnieuw.',
    401: 'Je gegevens zijn niet juist of je sessie is verlopen. Log opnieuw in.',
    403: 'Je hebt geen toestemming om deze actie uit te voeren.',
    404: 'De gevraagde informatie is niet gevonden.',
    409: 'Deze actie kan niet worden uitgevoerd omdat er een conflict is.',
    422: 'Controleer de ingevulde gegevens en probeer het opnieuw.',
    429: 'Je doet dit te vaak achter elkaar. Probeer het later opnieuw.',
  };

  if (status >= 500) {
    return 'Er is iets misgegaan op de server. Probeer het later opnieuw.';
  }

  return messages[status] || 'Er is iets misgegaan. Probeer het opnieuw.';
}

async function request(path, options = {}) {
  const hasBody = options.body !== undefined;
  const headers = {
    Accept: 'application/json',
    ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    ...(options.headers || {}),
  };

  let response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers,
      body: hasBody ? JSON.stringify(options.body) : undefined,
    });
  } catch (_) {
    const error = new Error(
      'Kan de server niet bereiken. Controleer je internetverbinding en probeer opnieuw.'
    );
    error.status = null;
    error.code = 'NETWORK_ERROR';
    error.data = null;
    throw error;
  }

  const text = await response.text();
  let data = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch (_) {
      data = { message: text };
    }
  }

  if (!response.ok) {
    const error = new Error(getDutchErrorMessage(response.status, data));
    error.status = response.status;
    error.code = data && typeof data.code === 'string'
      ? data.code
      : `HTTP_${response.status}`;
    error.data = data;
    throw error;
  }

  return data;
}

const get = (path) => request(path, { method: 'GET' });
const post = (path, body) => request(path, { method: 'POST', body });

const api = {
  baseUrl: BASE_URL,

  setToken(token) {
    authToken = token || null;
  },

  register({ firstName, lastName, age, email, phone, password }) {
    return post('/auth/register', {
      firstName,
      lastName,
      age,
      email,
      phone,
      password,
    });
  },

  login({ email, password }) {
    return post('/auth/login', { email, password });
  },

  requestPasswordReset(email) {
    return post('/auth/password-reset/request', { email });
  },

  confirmPasswordReset(token, password) {
    return post('/auth/password-reset/confirm', { token, password });
  },

  getMe() {
    return get('/me');
  },

  getEntitlements() {
    return get('/entitlements');
  },

  getBankConnectStatus() { return get('/bank-connect/status'); },
  createBankTicket(payload) { return post('/bank-connect/ticket', payload); },
  getBudgetProfile() {
    return get('/budget-profile');
  },

  updateBudgetProfile(payload) {
    return request('/budget-profile', { method: 'PUT', body: payload });
  },

  sendSupport(payload) {
    return post('/support', payload);
  },

  getAdminOverview() {
    return get('/admin/overview');
  },

  getAdminUsers() {
    return get('/admin/users');
  },

  getAdminSubscriptions() {
    return get('/admin/subscriptions');
  },

  getAdminPayouts() {
    return get('/admin/payouts');
  },

  getAdminSupport() {
    return get('/admin/support');
  },

  getAdminAudit() {
    return get('/admin/audit');
  },

  setAdminUserRole(id, { role }) {
    return post(`/admin/users/${encodeURIComponent(id)}/role`, { role });
  },

  setAdminUserStatus(id, { status }) {
    return post(`/admin/users/${encodeURIComponent(id)}/status`, { status });
  },

  setAdminSupportStatus(id, { status }) {
    return post(`/admin/support/${encodeURIComponent(id)}/status`, { status });
  },

  cancelAdminSubscription(id, { immediate = true } = {}) {
    return post(`/admin/subscriptions/${encodeURIComponent(id)}/cancel`, { immediate });
  },

  sendOwnerPasswordReset() {
    return post('/admin/password-reset', { email: 'dbijl97@outlook.com' });
  },
};

export default api;