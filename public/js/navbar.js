// MCIntroduce Shared Navbar Authentication Component
// Strict adherence to security rules: user-provided text is set via textContent, never innerHTML.

// Transparently attach Bearer token to all /api/ requests for iframe cross-domain resilience
(function setupAuthFetch() {
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
      // Ignore errors in fetch interception
    }
    return origFetch.call(this, input, init);
  };
})();

function renderLoggedOut(navActions) {
  if (!navActions) return;
  navActions.replaceChildren();

  const loginLink = document.createElement('a');
  loginLink.href = '/login.html';
  loginLink.className = 'btn btn-secondary btn-sm';
  loginLink.textContent = 'Log In';

  const registerLink = document.createElement('a');
  registerLink.href = '/register.html';
  registerLink.className = 'btn btn-primary btn-sm';
  registerLink.textContent = 'Register';

  navActions.appendChild(loginLink);
  navActions.appendChild(registerLink);
}

async function initNavbar() {
  // Highlight current active link in navigation
  const currentPath = window.location.pathname;
  const navLinks = document.querySelectorAll('.nav-links .nav-link');
  navLinks.forEach((link) => {
    const href = link.getAttribute('href');
    if (
      href === currentPath ||
      (currentPath === '/' && (href === '/' || href === '/index.html')) ||
      (currentPath === '/index.html' && href === '/')
    ) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
  });

  const navActions = document.getElementById('nav-actions');
  if (!navActions) return;

  // Render logged-out buttons initially if empty
  if (navActions.children.length === 0) {
    renderLoggedOut(navActions);
  }

  try {
    const token = localStorage.getItem('mc_auth_token');
    const headers = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch('/api/auth/me', { headers });
    if (!res.ok) {
      renderLoggedOut(navActions);
      return;
    }
    const data = await res.json();

    if (data.loggedIn && data.user) {
      if (window.MCAuth) {
        window.MCAuth.setAuth(null, data.user);
      }

      // Add relevant nav links based on role (cleanly preventing duplicates)
      const navLinksContainer = document.querySelector('.nav-links');
      if (navLinksContainer) {
        // Remove any pre-existing dynamic links to guarantee zero duplicate links
        const existingDynamicLinks = navLinksContainer.querySelectorAll(
          'a[href="/my-downloads.html"], a[href="/dashboard.html"], a[href="/modpack-create.html"], #nav-my-downloads, #nav-dashboard, #nav-publish'
        );
        existingDynamicLinks.forEach((el) => el.remove());

        // My Downloads for all logged-in users
        const myDl = document.createElement('a');
        myDl.id = 'nav-my-downloads';
        myDl.href = '/my-downloads.html';
        myDl.className = 'nav-link' + (currentPath === '/my-downloads.html' ? ' active' : '');
        myDl.textContent = 'My Downloads';
        navLinksContainer.appendChild(myDl);

        // Dashboard & Publish Modpack ONLY for Admin (doki)
        if (data.user.role === 'admin') {
          const dash = document.createElement('a');
          dash.id = 'nav-dashboard';
          dash.href = '/dashboard.html';
          dash.className = 'nav-link' + (currentPath === '/dashboard.html' ? ' active' : '');
          dash.innerHTML = `<svg class="icon-svg icon-svg-sm" style="color:#2dd4bf; margin-right:4px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4l3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14v2H5z"></path></svg>Admin Dashboard`;
          navLinksContainer.appendChild(dash);

          const pub = document.createElement('a');
          pub.id = 'nav-publish';
          pub.href = '/modpack-create.html';
          pub.className = 'nav-link' + (currentPath === '/modpack-create.html' ? ' active' : '');
          pub.innerHTML = `<svg class="icon-svg icon-svg-sm" style="margin-right:4px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>Upload Modpack`;
          navLinksContainer.appendChild(pub);
        }
      }

      // Clear actions container before building user badge
      navActions.replaceChildren();

      // User badge
      const badge = document.createElement('div');
      badge.className = 'user-badge';
      if (data.user.role === 'admin') {
        badge.style.borderColor = '#2dd4bf';
        badge.style.background = 'rgba(45, 212, 191, 0.15)';
      }

      const icon = document.createElement('span');
      icon.className = 'user-avatar-icon-2d';
      icon.style.display = 'inline-flex';
      icon.style.alignItems = 'center';
      if (data.user.role === 'admin') {
        icon.innerHTML = `<svg class="icon-svg icon-svg-sm" style="color:#2dd4bf;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4l3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14v2H5z"></path></svg>`;
      } else {
        icon.innerHTML = `<svg class="icon-svg icon-svg-sm" style="color:var(--accent-green-light);" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 9.5L4 20"></path><path d="M14 4l6 6"></path><path d="M17.5 2.5a14 14 0 0 0-8 8"></path><path d="M13.5 14.5a14 14 0 0 0 8-8"></path></svg>`;
      }
      badge.appendChild(icon);

      const usernameSpan = document.createElement('span');
      usernameSpan.className = 'username-display';
      // User-provided text with textContent, NEVER innerHTML
      usernameSpan.textContent = data.user.role === 'admin' ? `${data.user.username} [ADMIN]` : data.user.username;
      badge.appendChild(usernameSpan);

      const logoutBtn = document.createElement('button');
      logoutBtn.className = 'btn btn-danger btn-sm';
      logoutBtn.textContent = 'Logout';
      logoutBtn.addEventListener('click', async () => {
        try {
          logoutBtn.disabled = true;
          logoutBtn.textContent = 'Logging out...';
          const logoutRes = await fetch('/api/auth/logout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          });
          if (logoutRes.ok) {
            localStorage.removeItem('mc_auth_token');
            localStorage.removeItem('mc_user');
            window.location.href = '/';
          } else {
            alert('Failed to log out. Please try again.');
            logoutBtn.disabled = false;
            logoutBtn.textContent = 'Logout';
          }
        } catch (err) {
          console.error('Logout error:', err);
          logoutBtn.disabled = false;
          logoutBtn.textContent = 'Logout';
        }
      });

      navActions.appendChild(badge);
      navActions.appendChild(logoutBtn);
    } else {
      renderLoggedOut(navActions);
    }
  } catch (err) {
    console.warn('Navbar auth error, rendering logged-out view:', err);
    renderLoggedOut(navActions);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initNavbar);
} else {
  initNavbar();
}
