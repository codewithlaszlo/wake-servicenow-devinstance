#!/usr/bin/env node
import express from 'express';
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// State management
let state = {
  status: 'unknown', // unknown, checking, online, offline, waking, error
  lastChecked: null,
  lastWakeAttempt: null,
  error: null,
  instanceName: null
};

let isOperationInProgress = false;

// Sleep helper
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

// Simple status check - just HTTP request to instance URL
async function checkInstanceStatusSimple() {
  const instanceUrl = process.env.INSTANCE_URL || 'https://dev281644.service-now.com/';
  
  try {
    const response = await fetch(instanceUrl, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const html = await response.text();
    
    // Check if hibernating page is shown
    if (html.includes('Your instance is hibernating') || 
        html.includes('instance-hibernating-page')) {
      state.status = 'offline';
      state.lastChecked = new Date().toISOString();
      return { success: true, status: 'offline', method: 'http' };
    } else {
      state.status = 'online';
      state.lastChecked = new Date().toISOString();
      return { success: true, status: 'online', method: 'http' };
    }
  } catch (error) {
    state.status = 'error';
    state.error = `HTTP check failed: ${error.message}`;
    state.lastChecked = new Date().toISOString();
    return { success: false, error: error.message };
  }
}

// Check instance status
async function checkInstanceStatus() {
  if (isOperationInProgress) {
    return { success: false, error: 'Operation already in progress' };
  }

  isOperationInProgress = true;
  state.status = 'checking';
  state.error = null;

  const username = process.env.SERVICENOW_USERNAME;
  const password = process.env.SERVICENOW_PASSWORD;

  if (!username || !password) {
    state.status = 'error';
    state.error = 'Missing credentials';
    isOperationInProgress = false;
    return { success: false, error: 'Missing SERVICENOW_USERNAME or SERVICENOW_PASSWORD environment variables' };
  }

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    // Navigate and login (simplified version)
    await page.goto('https://developer.servicenow.com/dev.do', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    // Dismiss cookie banner
    await sleep(2000);
    try {
      await page.evaluate(() => {
        const overlays = document.querySelectorAll('.truste_box_overlay, .truste_overlay, div[id*="pop-div"]');
        overlays.forEach(el => el.style.display = 'none');
      });
    } catch (e) {}

    // Click Sign In
    await page.click('button.sn-cx-navigation__utility-button-signin', { force: true, timeout: 30000 });
    await sleep(3000);

    // Find SSO frame
    let frame = page.mainFrame();
    let ssoFrame = page.frame({ url: /signon\.service-now\.com/ });
    if (!ssoFrame) {
      await sleep(2000);
      ssoFrame = page.frame({ url: /signon\.service-now\.com/ });
    }
    if (ssoFrame) frame = ssoFrame;

    // Fill email
    const emailInput = await frame.waitForSelector('input[type="email"], input[name="username"], #username', { timeout: 15000 });
    await emailInput.fill(username);
    await sleep(500);

    // Click Next
    try {
      const nextButton = await frame.waitForSelector('button:has-text("Next"), button[type="submit"]', { timeout: 3000 });
      await nextButton.click();
    } catch (e) {
      await emailInput.press('Enter');
    }

    // Fill password
    await sleep(2000);
    const passwordInput = await frame.waitForSelector('input[type="password"]', { timeout: 15000 });
    await passwordInput.fill(password);
    await sleep(500);

    // Submit
    try {
      const submitButton = await frame.waitForSelector('button:has-text("Sign in"), button[type="submit"]', { timeout: 3000 });
      await submitButton.click();
    } catch (e) {
      await passwordInput.press('Enter');
    }

    // Wait for portal to load
    await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
    await sleep(5000);

    // Dismiss post-login cookie banner
    try {
      await page.evaluate(() => {
        const overlays = document.querySelectorAll('.truste_box_overlay, .truste_overlay, div[id*="pop-div"]');
        overlays.forEach(el => {
          el.style.display = 'none';
          el.style.visibility = 'hidden';
        });
      });
    } catch (e) {}

    // Wait for content to load
    await page.waitForSelector('dps-app', { timeout: 30000 });
    await sleep(5000);

    // Wait for shadow DOM content
    for (let i = 0; i < 30; i++) {
      const contentStatus = await page.evaluate(() => {
        const dpsApp = document.querySelector('dps-app');
        if (!dpsApp || !dpsApp.shadowRoot) return { ready: false };
        const text = dpsApp.shadowRoot.textContent || '';
        return {
          ready: text.length > 100 && (text.includes('PDI') || text.includes('Status')),
          length: text.length
        };
      });
      
      if (contentStatus.ready) break;
      await sleep(1000);
    }

    // Scroll to reveal instance info
    await page.evaluate(() => window.scrollTo({ top: 400, behavior: 'auto' }));
    await sleep(2000);

    // Get instance status from shadow DOM
    const instanceInfo = await page.evaluate(() => {
      function findInShadowDOM(root, selector) {
        if (!root) return null;
        const direct = root.querySelector(selector);
        if (direct) return direct;
        const allElements = root.querySelectorAll('*');
        for (const el of allElements) {
          if (el.shadowRoot) {
            const found = findInShadowDOM(el.shadowRoot, selector);
            if (found) return found;
          }
        }
        return null;
      }

      function getAllShadowText(root) {
        if (!root) return '';
        let text = root.textContent || '';
        const allElements = root.querySelectorAll('*');
        for (const el of allElements) {
          if (el.shadowRoot) text += getAllShadowText(el.shadowRoot);
        }
        return text;
      }

      const dpsApp = document.querySelector('dps-app');
      if (!dpsApp || !dpsApp.shadowRoot) {
        return { found: false, error: 'No shadow DOM' };
      }

      const appShadow = dpsApp.shadowRoot;
      const statusText = findInShadowDOM(appShadow, '.status-text');
      
      if (statusText && statusText.textContent?.trim()) {
        return {
          found: true,
          status: statusText.textContent.trim(),
          location: 'shadow DOM'
        };
      }

      // Try text-based detection
      const allText = getAllShadowText(appShadow);
      if (allText.includes('Online')) {
        return { found: true, status: 'Online', location: 'text search' };
      } else if (allText.includes('Offline')) {
        return { found: true, status: 'Offline', location: 'text search' };
      }

      // Try to find PDI name
      const pdiMatch = allText.match(/Your PDI:\s*([a-zA-Z0-9]+)/);
      const instanceName = pdiMatch ? pdiMatch[1] : null;

      return { found: false, error: 'Status not found', instanceName };
    });

    await browser.close();

    if (instanceInfo.found) {
      const statusLower = instanceInfo.status.toLowerCase();
      if (statusLower.includes('online')) {
        state.status = 'online';
      } else if (statusLower.includes('offline') || statusLower.includes('hibernate')) {
        state.status = 'offline';
      } else {
        state.status = 'unknown';
      }
      state.instanceName = instanceInfo.instanceName || null;
      state.lastChecked = new Date().toISOString();
      isOperationInProgress = false;
      return { success: true, status: state.status };
    } else {
      state.status = 'error';
      state.error = instanceInfo.error || 'Could not determine status';
      state.lastChecked = new Date().toISOString();
      isOperationInProgress = false;
      return { success: false, error: state.error };
    }

  } catch (error) {
    if (browser) await browser.close();
    state.status = 'error';
    state.error = error.message;
    state.lastChecked = new Date().toISOString();
    isOperationInProgress = false;
    return { success: false, error: error.message };
  }
}

// API Routes
app.get('/api/status', async (req, res) => {
  // If status is old (> 2 minutes), check again using simple HTTP method
  if (!state.lastChecked || (Date.now() - new Date(state.lastChecked).getTime() > 2 * 60 * 1000)) {
    if (!isOperationInProgress) {
      // Use simple HTTP check instead of full browser automation
      checkInstanceStatusSimple().catch(console.error);
    }
  }

  res.json({
    status: state.status,
    lastChecked: state.lastChecked,
    lastWakeAttempt: state.lastWakeAttempt,
    error: state.error,
    instanceName: state.instanceName,
    instanceUrl: process.env.INSTANCE_URL || 'https://dev281644.service-now.com/'
  });
});

app.post('/api/wake', async (req, res) => {
  if (isOperationInProgress) {
    return res.status(429).json({ error: 'Operation already in progress' });
  }

  state.status = 'waking';
  state.lastWakeAttempt = new Date().toISOString();
  
  // Start wake process in background - THIS uses full browser automation
  // The act of logging in wakes the instance
  checkInstanceStatus().catch(console.error);

  res.json({ 
    message: 'Wake process started - logging into developer portal',
    status: 'waking',
    estimatedTime: '10 minutes'
  });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy' });
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`ServiceNow Wake Service running on port ${PORT}`);
  console.log(`Instance URL: ${process.env.INSTANCE_URL || 'https://dev281644.service-now.com/'}`);
  
  // Do initial status check using simple HTTP method (no login required)
  console.log('Performing initial instance status check...');
  checkInstanceStatusSimple()
    .then(result => {
      console.log(`✓ Initial status: ${result.status} (checked via ${result.method})`);
    })
    .catch(error => {
      console.error(`✗ Initial status check failed:`, error.message);
    });
});

