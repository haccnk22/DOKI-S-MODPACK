// MCIntroduce Global Auth Interceptor & Token Manager
// Ensures 100% resilient authentication across iframes, third-party cookie restrictions, and direct navigation

(function initMCAuth() {
  // 1. Transparently attach Bearer token to all /api/ requests
  const origFetch = window.fetch;
  window.fetch = function(input, init = {}) {
    try {
      const token = localStorage.getItem('mc_auth_token');
      const url = typeof input === 'string' ? input : (input && input.url ? input.url : '');
      if (token && url.startsWith('/api/')) {
        const headers = new Headers(init.headers || {});
        if (!headers.has('Authorization')) {
          headers.set('Authorization', 'Bearer ' + token);
        }
        init.headers = headers;
      }
    } catch (e) {
      console.warn('Auth fetch error:', e);
    }
    return origFetch.call(this, input, init);
  };

  // 2. Global helper utilities
  window.MCAuth = {
    getToken() {
      try {
        return localStorage.getItem('mc_auth_token') || null;
      } catch (e) {
        return null;
      }
    },
    getUser() {
      try {
        const u = localStorage.getItem('mc_user');
        return u ? JSON.parse(u) : null;
      } catch (e) {
        return null;
      }
    },
    setAuth(token, user) {
      try {
        if (token) localStorage.setItem('mc_auth_token', token);
        if (user) localStorage.setItem('mc_user', JSON.stringify(user));
      } catch (e) {}
    },
    clearAuth() {
      try {
        localStorage.removeItem('mc_auth_token');
        localStorage.removeItem('mc_user');
      } catch (e) {}
    },
    async getCurrentUser() {
      try {
        const token = this.getToken();
        const cachedUser = this.getUser();
        const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
        const res = await fetch('/api/auth/me', { headers });

        if (res.ok) {
          const data = await res.json();
          if (data.loggedIn && data.user) {
            this.setAuth(token, data.user);
            return data;
          }
        }

        // Only clear auth if server explicitly returned 401 Unauthorized
        if (res.status === 401) {
          this.clearAuth();
          return { loggedIn: false, user: null };
        }

        // Network error or 50x server restart: soft fallback to cached user if token exists
        if (token && cachedUser) {
          return { loggedIn: true, user: cachedUser, isCached: true };
        }

        return { loggedIn: false, user: null };
      } catch (e) {
        const token = this.getToken();
        const cachedUser = this.getUser();
        if (token && cachedUser) {
          return { loggedIn: true, user: cachedUser, isCached: true };
        }
        return { loggedIn: false, user: null };
      }
    },
    async requireLogin(returnUrl) {
      const auth = await this.getCurrentUser();
      if (!auth.loggedIn) {
        const target = returnUrl || window.location.pathname + window.location.search;
        window.location.href = `/login.html?returnUrl=${encodeURIComponent(target)}`;
        return false;
      }
      return auth.user;
    },
    async requireAdmin(returnUrl) {
      const user = await this.requireLogin(returnUrl);
      if (!user) return false;
      if (user.role !== 'admin') {
        alert('Access denied: Only the admin (doki) can manage modpacks.');
        window.location.href = '/modpacks.html';
        return false;
      }
      return user;
    },
    getDownloadUrl(modpackId) {
      const token = this.getToken();
      let url = `/api/modpacks/${modpackId}/download`;
      if (token) {
        url += `?auth_token=${encodeURIComponent(token)}`;
      }
      return url;
    }
  };
})();
