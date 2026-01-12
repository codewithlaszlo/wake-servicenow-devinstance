#!/usr/bin/env node
import ora from 'ora';
import { chromium } from 'playwright';
import commandLineArgs from 'command-line-args';

const INSTANCE_WAKE_DELAY = 5000;

const optionDefinitions = [
  { name: 'username', alias: 'u', type: String },
  { name: 'password', alias: 'p', type: String },
  { name: 'headfull', alias: 'v', type: Boolean },
];

// Sleep helper
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

const checkForInstanceWakingUpStatus = async (belowButtonLocator, spinner) => {
  if ((await belowButtonLocator.count()) >= 1) {
    const text = await belowButtonLocator.textContent();
    if (text?.includes('Waking up instance')) {
      spinner.text = 'Instance is waking';
      await sleep(INSTANCE_WAKE_DELAY);
      return checkForInstanceWakingUpStatus(belowButtonLocator, spinner);
    }
  }
  return spinner;
};

(async () => {
  const { headfull, ...cli } = commandLineArgs(optionDefinitions);

  const username =
    process.env.SERVICENOW_USERNAME?.length
      ? process.env.SERVICENOW_USERNAME
      : cli.username?.length
        ? cli.username
        : null;
  const password =
    process.env.SERVICENOW_PASSWORD?.length
      ? process.env.SERVICENOW_PASSWORD
      : cli.password?.length
        ? cli.password
        : null;

  if (!username || !password) {
    throw new Error('Username and password must be provided');
  }

  let spinner = ora('Starting ServiceNow waker').start();
  
  // Helper function to log sub-steps
  const logSubStep = (message) => {
    spinner.text = message;
  };
  
  const completeStep = (message) => {
    spinner.succeed(message);
    return ora().start();
  };

  const browser = await chromium.launch({ headless: !headfull });
  const page = await browser.newPage();

  // Error handler - take screenshot on failure
  const handleError = async (error) => {
    try {
      const screenshotPath = `debug-screenshot-${Date.now()}.png`;
      await page.screenshot({ path: screenshotPath, fullPage: true });
      spinner.fail(`Error occurred. Screenshot saved to: ${screenshotPath}`);
    } catch (e) {
      spinner.fail('Error occurred (could not save screenshot)');
    }
    await browser.close();
    throw error;
  };

  try {

  // 1️⃣ Navigate to ServiceNow Developer portal
  spinner.text = 'Navigating to ServiceNow Developer portal';
  await page.goto('https://developer.servicenow.com/dev.do', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  spinner = completeStep('ServiceNow Developer page opened');
  spinner.text = 'Handling cookie banner';

  // 2️⃣ Dismiss TrustArc cookie consent banner if present
  try {
    // Wait for TrustArc to load
    await sleep(2000);
    
    // Check if the overlay is present
    const trustarcOverlay = page.locator('.truste_box_overlay, div[id*="pop-div"]').first();
    if ((await trustarcOverlay.count()) > 0 && await trustarcOverlay.isVisible()) {
      logSubStep('  → Found cookie banner, looking for iframe');
      
      // Find the TrustArc iframe
      const trustarcFrame = page.frameLocator('iframe[title*="Cookie Consent" i], iframe[id*="pop-frame"], iframe.truste_popframe').first();
      
      // Try to find and click the accept/agree button inside the iframe
      const acceptButtons = [
        'button.trustarc-agree-btn',
        'button:has-text("Accept")',
        'button:has-text("Agree")',
        'button:has-text("Accept All")',
        'a.trustarc-agree-btn',
        'a:has-text("Accept")',
        'a.truste-button1'
      ];
      
      let clicked = false;
      for (const selector of acceptButtons) {
        try {
          const button = trustarcFrame.locator(selector).first();
          if (await button.isVisible({ timeout: 2000 })) {
            await button.click({ timeout: 2000 });
            clicked = true;
            logSubStep('  → Cookie banner button clicked');
            await sleep(1000);
            break;
          }
        } catch (e) {
          continue;
        }
      }
      
      if (!clicked) {
        // Last resort: try to hide the overlay using JavaScript
        try {
          await page.evaluate(() => {
            const overlays = document.querySelectorAll('.truste_box_overlay, .truste_overlay, div[id*="pop-div"]');
            overlays.forEach(el => el.style.display = 'none');
          });
          logSubStep('  → Cookie banner hidden via JavaScript');
        } catch (e) {
          logSubStep('  → Cookie banner present but could not dismiss');
        }
      }
    }
  } catch (e) {
    // Cookie banner not found or already dismissed, continue
    logSubStep('  → No cookie banner found');
  }
  
  await sleep(500);
  spinner = completeStep('Cookie banner handled');

  spinner.text = 'Clicking Sign In button';

  // 3️⃣ Click the first "Sign In" button with force option to bypass overlays
  await page.waitForSelector(
    'button.sn-cx-navigation__utility-button-signin',
    { timeout: 30000 }
  );
  
  // Click and wait for navigation
  const [response] = await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => null),
    page.click('button.sn-cx-navigation__utility-button-signin', { force: true })
  ]);
  spinner = completeStep('Clicked Sign In button');

  spinner.text = 'Waiting for login page to load';
  await sleep(3000); // Give SSO redirect time to complete

  // 4️⃣ Detect SSO frame or popup - try multiple approaches
  let frame = page.mainFrame();
  
  // Try to find SSO frame
  let ssoFrame = page.frame({ url: /signon\.service-now\.com/ });
  if (!ssoFrame) {
    // Wait a bit more and try again
    await sleep(2000);
    ssoFrame = page.frame({ url: /signon\.service-now\.com/ });
  }
  if (!ssoFrame) {
    // Try finding by name
    ssoFrame = page.frames().find(f => f.url().includes('signon.service-now.com') || f.url().includes('login'));
  }
  
  if (ssoFrame) {
    frame = ssoFrame;
    logSubStep('  → Found SSO frame');
  } else {
    logSubStep('  → Using main frame');
  }
  spinner = completeStep('Login page loaded');

  // 5️⃣ STEP 1: Wait for email input (two-step authentication)
  spinner.text = 'Looking for email field';
  const emailSelectors = [
    'input[type="email"]',
    'input[name="username"]',
    'input[name="email"]',
    '#username',
    'input[name="user_name"]',
    'input[id*="email" i]',
    'input[id*="username" i]'
  ];
  
  let emailInput = null;
  for (const selector of emailSelectors) {
    try {
      emailInput = await frame.waitForSelector(selector, { timeout: 10000, state: 'visible' });
      if (emailInput) {
        logSubStep(`  → Found email field`);
        break;
      }
    } catch (e) {
      continue;
    }
  }
  
  if (!emailInput) {
    const currentUrl = page.url();
    const frameUrls = page.frames().map(f => f.url()).join(', ');
    const error = new Error(
      `Cannot find email input. Current URL: ${currentUrl}. Frames: ${frameUrls}`
    );
    await handleError(error);
  }

  // 6️⃣ Fill email
  logSubStep('  → Filling email');
  await emailInput.fill(username);
  await sleep(500);
  spinner = completeStep('Email entered');

  // 7️⃣ Click "Next" button to proceed to password step
  spinner.text = 'Proceeding to password step';
  const nextButtonSelectors = [
    'button:has-text("Next")',
    'input[type="submit"]',
    'button[type="submit"]',
    'button.button-primary',
    'button[value="Next"]'
  ];
  
  let nextClicked = false;
  for (const selector of nextButtonSelectors) {
    try {
      const nextButton = await frame.waitForSelector(selector, { timeout: 3000, state: 'visible' });
      if (nextButton) {
        await nextButton.click();
        nextClicked = true;
        logSubStep('  → Clicked Next button');
        break;
      }
    } catch (e) {
      continue;
    }
  }
  
  if (!nextClicked) {
    await emailInput.press('Enter');
    logSubStep('  → Pressed Enter');
  }
  spinner = completeStep('Proceeded to password step');

  // 8️⃣ STEP 2: Wait for password field (second step)
  spinner.text = 'Looking for password field';
  await sleep(2000);
  
  const passwordSelectors = [
    'input[type="password"]',
    '#password',
    'input[name="password"]',
    'input[name="user_password"]',
    'input[id*="password" i]'
  ];
  
  let passwordInput = null;
  for (const selector of passwordSelectors) {
    try {
      passwordInput = await frame.waitForSelector(selector, { timeout: 15000, state: 'visible' });
      if (passwordInput) {
        logSubStep(`  → Found password field`);
        break;
      }
    } catch (e) {
      continue;
    }
  }
  
  if (!passwordInput) {
    const error = new Error('Cannot find password input after clicking Next');
    await handleError(error);
  }

  // 9️⃣ Fill password
  logSubStep('  → Filling password');
  await passwordInput.fill(password);
  await sleep(500);
  spinner = completeStep('Password entered');

  // 🔟 Submit
  spinner.text = 'Submitting credentials';
  const submitSelectors = [
    'button:has-text("Sign in")',
    'button:has-text("Log in")',
    'button:has-text("Submit")',
    'button[type="submit"]',
    'input[type="submit"]',
    '#challenge-authenticator-submit'
  ];
  
  let submitted = false;
  for (const selector of submitSelectors) {
    try {
      const submitButton = await frame.waitForSelector(selector, { timeout: 3000, state: 'visible' });
      if (submitButton) {
        await submitButton.click();
        submitted = true;
        logSubStep('  → Submit button clicked');
        break;
      }
    } catch (e) {
      continue;
    }
  }
  
  if (!submitted) {
    await passwordInput.press('Enter');
    logSubStep('  → Pressed Enter to submit');
  }

  spinner.text = 'Waiting for portal to load';

  // 1️⃣1️⃣ Wait for main portal to load
  try {
    await page.waitForLoadState('networkidle', { timeout: 120000 });
  } catch (e) {
    // Network idle might timeout, but we can continue if we detect the portal loaded
    await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
  }
  spinner = completeStep('Logged into ServiceNow Developer account');
  spinner.text = 'Handling post-login cookie banner';

  // 1️⃣2️⃣ Dismiss cookie banner again (it may reappear after login)
  try {
    logSubStep('  → Checking for cookie banner');
    
    // Wait up to 10 seconds for the overlay to become visible
    const trustarcOverlay = page.locator('.truste_box_overlay, div[id*="pop-div"]').first();
    
    try {
      await trustarcOverlay.waitFor({ state: 'visible', timeout: 10000 });
      logSubStep('  → Cookie banner appeared');
      
      // Give the iframe inside time to load
      await sleep(2000);
      
      // Find the TrustArc iframe
      const trustarcFrame = page.frameLocator('iframe[title*="Cookie Consent" i], iframe[id*="pop-frame"], iframe.truste_popframe').first();
      
      // Try to find and click the accept/agree button inside the iframe
      const acceptButtons = [
        'button.trustarc-agree-btn',
        'button:has-text("Accept")',
        'button:has-text("Agree")',
        'button:has-text("Accept All")',
        'a.trustarc-agree-btn',
        'a:has-text("Accept")',
        'a.truste-button1',
        '.truste-button1'
      ];
      
      let clicked = false;
      for (const selector of acceptButtons) {
        try {
          const button = trustarcFrame.locator(selector).first();
          await button.waitFor({ state: 'visible', timeout: 3000 });
          await button.click({ timeout: 2000 });
          clicked = true;
          logSubStep('  → Cookie banner dismissed');
          await sleep(1500);
          break;
        } catch (e) {
          continue;
        }
      }
      
      if (!clicked) {
        // Last resort: try to hide the overlay using JavaScript
        try {
          await page.evaluate(() => {
            const overlays = document.querySelectorAll('.truste_box_overlay, .truste_overlay, div[id*="pop-div"]');
            overlays.forEach(el => {
              el.style.display = 'none';
              el.style.visibility = 'hidden';
            });
          });
          logSubStep('  → Banner hidden via JavaScript');
          await sleep(1000);
        } catch (e) {
          logSubStep('  → Could not dismiss banner');
        }
      }
    } catch (e) {
      // Timeout waiting for banner - it didn't appear
      logSubStep('  → No cookie banner found');
    }
  } catch (e) {
    logSubStep('  → No cookie banner or already dismissed');
  }
  
  spinner = completeStep('Post-login cookie banner handled');
  spinner.text = 'Loading developer portal content';

  // 1️⃣3️⃣ Wait for dps-app to fully load and render its shadow DOM
  try {
    // Wait for the dps-app custom element to be present
    await page.waitForSelector('dps-app', { timeout: 30000 });
    logSubStep('  → Found dps-app element');
    
    // The page loads via JavaScript modules that create shadow DOMs
    // We need to wait for the actual content to be rendered, not just the shell
    
    // Wait longer for the JavaScript app to fully initialize
    await sleep(5000);
    
    // Check if any content has been rendered inside dps-app's shadow root
    let contentReady = false;
    for (let i = 0; i < 30; i++) {
      const status = await page.evaluate(() => {
        const dpsApp = document.querySelector('dps-app');
        if (!dpsApp || !dpsApp.shadowRoot) {
          return { ready: false, reason: 'No shadowRoot on dps-app' };
        }
        
        // Check if there's any substantial content rendered
        const shadowContent = dpsApp.shadowRoot.textContent || '';
        const hasContent = shadowContent.length > 100;
        
        // Look for specific indicators that the page is loaded
        const hasPDI = shadowContent.includes('Your PDI') || shadowContent.includes('PDI:');
        const hasStatus = shadowContent.includes('Status') || shadowContent.includes('Online') || shadowContent.includes('Offline');
        const hasInstance = shadowContent.includes('instance') || shadowContent.includes('Instance');
        
        return {
          ready: hasContent && (hasPDI || hasStatus || hasInstance),
          hasContent,
          hasPDI,
          hasStatus,
          hasInstance,
          contentLength: shadowContent.length,
          contentSnippet: shadowContent.substring(0, 200)
        };
      });
      
      if (status.ready) {
        contentReady = true;
        logSubStep('  → Content fully rendered');
        break;
      }
      
      logSubStep(`  → Waiting for content... ${i + 1}/30 (${status.contentLength} chars)`);
      await sleep(1000);
    }
    
    if (!contentReady) {
      logSubStep('  → Content may not be fully loaded');
    }
    
    // Additional wait and scroll to ensure everything is visible
    await sleep(2000);
    await page.evaluate(() => {
      window.scrollTo({ top: 400, behavior: 'smooth' });
    });
    logSubStep('  → Scrolled page to reveal instance info');
    await sleep(1000);
    
  } catch (e) {
    logSubStep('  → Portal loading timed out');
  }
  
  spinner = completeStep('Developer portal loaded');

  // 1️⃣4️⃣ Save full page source for debugging
  spinner.text = 'Checking instance status';
  
  try {
    const fs = await import('fs');
    const debugHtml = await page.content();
    const timestamp = Date.now();
    fs.writeFileSync(`debug-page-${timestamp}.html`, debugHtml);
    await page.screenshot({ path: `debug-screenshot-${timestamp}.png`, fullPage: true });
    logSubStep(`  → Debug files saved (timestamp: ${timestamp})`);
  } catch (e) {
    logSubStep('  → Could not save debug files');
  }
  
  await sleep(1000);

  // 1️⃣5️⃣ Access shadow DOM to find instance controls
  logSubStep('  → Searching shadow DOM for instance status');
  
  // Use evaluate to access shadow DOM directly - search deeply
  const instanceInfo = await page.evaluate(() => {
    // Helper function to search recursively through shadow DOMs
    function findInShadowDOM(root, selector) {
      if (!root) return null;
      
      // Try direct query first
      const direct = root.querySelector(selector);
      if (direct) return direct;
      
      // Search through all elements with shadow roots
      const allElements = root.querySelectorAll('*');
      for (const el of allElements) {
        if (el.shadowRoot) {
          const found = findInShadowDOM(el.shadowRoot, selector);
          if (found) return found;
        }
      }
      return null;
    }
    
    // Helper to get all text content from shadow DOMs
    function getAllShadowText(root) {
      if (!root) return '';
      let text = root.textContent || '';
      
      const allElements = root.querySelectorAll('*');
      for (const el of allElements) {
        if (el.shadowRoot) {
          text += getAllShadowText(el.shadowRoot);
        }
      }
      return text;
    }
    
    let statusElement = null;
    let loginButton = null;
    
    const dpsApp = document.querySelector('dps-app');
    if (!dpsApp) {
      return { found: false, reason: 'dps-app not found' };
    }
    
    if (!dpsApp.shadowRoot) {
      return { found: false, reason: 'dps-app has no shadowRoot' };
    }
    
    const appShadow = dpsApp.shadowRoot;
    
    // Search for status-text deeply in all shadow DOMs
    const statusText = findInShadowDOM(appShadow, '.status-text');
    if (statusText && statusText.textContent?.trim()) {
      statusElement = {
        selector: '.status-text',
        text: statusText.textContent.trim(),
        visible: true,
        location: 'found via deep search'
      };
    }
    
    // Try status-info as backup
    if (!statusElement) {
      const statusInfo = findInShadowDOM(appShadow, '.status-info');
      if (statusInfo) {
        const statusClass = statusInfo.className || '';
        let status = 'Unknown';
        if (statusClass.includes('status-online')) status = 'Online';
        else if (statusClass.includes('status-offline')) status = 'Offline';
        else if (statusClass.includes('status-hibernate')) status = 'Hibernating';
        
        statusElement = {
          selector: '.status-info',
          text: status,
          visible: true,
          location: 'found via deep search'
        };
      }
    }
    
    // Try to find status by text content
    if (!statusElement) {
      const allText = getAllShadowText(appShadow);
      if (allText.includes('Online')) {
        statusElement = {
          selector: 'text-based',
          text: 'Online',
          visible: true,
          location: 'detected in shadow DOM text'
        };
      } else if (allText.includes('Offline')) {
        statusElement = {
          selector: 'text-based',
          text: 'Offline',
          visible: true,
          location: 'detected in shadow DOM text'
        };
      }
    }
    
    // Get all shadow text for debugging
    const allShadowText = getAllShadowText(appShadow);
    
    return {
      found: true,
      loginButton,
      statusElement,
      debug: {
        hasApp: !!dpsApp,
        hasAppShadow: !!dpsApp.shadowRoot,
        shadowTextLength: allShadowText.length,
        shadowTextSnippet: allShadowText.substring(0, 300),
        hasPDI: allShadowText.includes('PDI'),
        hasStatus: allShadowText.includes('Status'),
        hasOnline: allShadowText.includes('Online'),
        hasOffline: allShadowText.includes('Offline')
      }
    };
  });

  // 1️⃣6️⃣ Check instance status
  if (instanceInfo.statusElement) {
    const statusText = instanceInfo.statusElement.text;
    const location = instanceInfo.statusElement.location;
    logSubStep(`  → Found status: ${statusText}`);
    
    if (statusText.toLowerCase().includes('online') || statusText.toLowerCase().includes('active')) {
      spinner.succeed(`Instance is Online 🎉`);
    } else if (statusText.toLowerCase().includes('offline')) {
      spinner.warn(`Instance is Offline`);
    } else if (statusText.toLowerCase().includes('hibernate') || statusText.toLowerCase().includes('hibernating')) {
      spinner.warn(`Instance is Hibernating`);
    } else {
      spinner.info(`Instance status: ${statusText}`);
    }
  } else {
    // Status element not found, provide debug info
    const debugInfo = instanceInfo.debug || {};
    logSubStep(`  → Status element not found`);
    logSubStep(`  → Debug: ${JSON.stringify(debugInfo)}`);
    spinner.warn(`Could not determine instance status`);
  }

  await browser.close();
  } catch (error) {
    await handleError(error);
  }
})();
