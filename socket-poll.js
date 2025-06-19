// socket-poll.js
import 'dotenv/config';
import fetch from 'node-fetch';

const SOCKET_KEY = process.env.SOCKET_KEY;
const SLACK_WEBHOOK = process.env.SLACK_WEBHOOK;
const POLL_INTERVAL_MS = process.env.POLL_INTERVAL_MS
  ? +process.env.POLL_INTERVAL_MS
  : 600_000; // default 10 min
const SEVERITY_FILTER = process.env.SEVERITY_FILTER || 'high'; // default to high severity
const REPO_FILTER = process.env.REPO_FILTER ? process.env.REPO_FILTER.split(',') : null; // comma-separated list, null = all repos
const CATEGORY_FILTER = process.env.CATEGORY_FILTER ? process.env.CATEGORY_FILTER.split(',') : null; // comma-separated list, null = all categories

let seenAlerts = new Set();

async function fetchDependencies(offset = 0, accum = []) {
  try {
    const searchBody = { limit: 1000, offset };
    
    // Add repository filter if specified
    if (REPO_FILTER && REPO_FILTER.length > 0) {
      searchBody.repos = REPO_FILTER;
    }
    
    const res = await fetch('https://api.socket.dev/v0/dependencies/search', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SOCKET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(searchBody),
    });
    
    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }
    
    const j = await res.json();
    accum.push(...j.rows);
    if (!j.end) {
      return fetchDependencies(offset + j.limit, accum);
    }
    return accum;
  } catch (error) {
    console.error('Error fetching dependencies:', error);
    return accum;
  }
}

async function batchPackageLookup(purls) {
  try {
    console.log(`Making API request for ${purls.length} packages...`);
    console.log('Sample PURLs in this batch:', purls.slice(0, 3));
    const components = purls.map(purl => ({ purl }));
    
    const res = await fetch('https://api.socket.dev/v0/purl?alerts=true&compact=false&fixable=false', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SOCKET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ components }),
      // Add timeout
      signal: AbortSignal.timeout(30000), // 30 second timeout
    });
    
    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }
    
    console.log(`Received response for batch of ${purls.length} packages`);
    
    // Log the raw response to see what we're getting
    const responseText = await res.text();
    console.log('Raw response (first 500 chars):', responseText.substring(0, 500));
    
    try {
      // Handle NDJSON format (newline-delimited JSON)
      const lines = responseText.trim().split('\n');
      const parsedResults = [];
      
      for (const line of lines) {
        if (line.trim()) {
          try {
            const parsed = JSON.parse(line);
            parsedResults.push(parsed);
          } catch (lineError) {
            console.error('Error parsing line:', line, lineError);
          }
        }
      }
      
      console.log(`Parsed ${parsedResults.length} package results from NDJSON response`);
      return parsedResults;
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      console.error('Full response:', responseText);
      return [];
    }
  } catch (error) {
    console.error('Error in batch package lookup:', error);
    return [];
  }
}

async function notifySlack(msg) {
  if (!SLACK_WEBHOOK || SLACK_WEBHOOK === '<SLACK_WEBHOOK_URL>') {
    console.log('Slack webhook not configured, skipping notification');
    return;
  }
  
  try {
    await fetch(SLACK_WEBHOOK, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ text: msg }),
    });
  } catch (error) {
    console.error('Error sending Slack notification:', error);
  }
}

async function poll() {
  console.log('Polling dependencies...');
  console.log(`Filters: Severity=${SEVERITY_FILTER}, Repos=${REPO_FILTER ? REPO_FILTER.join(',') : 'all'}, Categories=${CATEGORY_FILTER ? CATEGORY_FILTER.join(',') : 'all'}`);
  
  const deps = await fetchDependencies();
  console.log(`Found ${deps.length} total dependencies.`);

  // Debug: Show package manager types
  const packageManagers = [...new Set(deps.map(d => d.type))];
  console.log('Package manager types found:', packageManagers);

  // Map package manager types to PURL format
  const purlMap = {
    'npm': 'npm',
    'pypi': 'pypi', 
    'maven': 'maven',
    'nuget': 'nuget',
    'gem': 'rubygems',
    'golang': 'golang'
  };

  const unique = Array.from(
    new Set(deps.map(d => {
      const purlType = purlMap[d.type] || d.type;
      return `pkg:${purlType}/${d.name}@${d.version}`;
    }))
  );
  console.log(`Processing ${unique.length} unique packages...`);

  // Process in batches to avoid overwhelming the API
  const BATCH_SIZE = 10; // Reduced from 50 to 10
  let alertCount = 0;
  
  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    const batch = unique.slice(i, i + BATCH_SIZE);
    console.log(`Processing batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(unique.length/BATCH_SIZE)} (${batch.length} packages)...`);
    
    const results = await batchPackageLookup(batch);
    
    // Process alerts immediately in this batch
    for (const pkg of results) {
      if (pkg.alerts && pkg.alerts.length > 0) {
        for (const alert of pkg.alerts) {
          // Only process alerts matching severity filter
          if (alert.severity !== SEVERITY_FILTER) continue;
          
          // Only process alerts matching category filter
          if (CATEGORY_FILTER && CATEGORY_FILTER.length > 0) {
            if (!alert.category || !CATEGORY_FILTER.includes(alert.category)) continue;
          }
          
          const pkgPurl = `pkg:${pkg.type}/${pkg.name}@${pkg.version}`;
          const key = `${pkgPurl}::${alert.type}::${alert.key || alert.id || alert.title}`;
          if (seenAlerts.has(key)) continue;
          seenAlerts.add(key);

          const msg = `*⚠️ Alert:* ${alert.type}\n*Package:* ${pkgPurl}\n*Severity:* ${alert.severity}\n*Category:* ${alert.category || 'unknown'}\n*Detail:* ${alert.title || alert.description || alert.type}\n`;
          await notifySlack(msg);
          console.log('Sent alert to Slack:', key);
          alertCount++;
        }
      }
    }
    
    console.log(`Batch ${Math.floor(i/BATCH_SIZE) + 1} complete. Found ${alertCount} alerts so far.`);
    
    // Add a small delay between batches to be respectful to the API
    if (i + BATCH_SIZE < unique.length) {
      console.log('Waiting 1 second before next batch...');
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  console.log(`Processed ${unique.length} packages, found ${alertCount} new alerts.`);
}

async function start() {
  await poll();
  setInterval(poll, POLL_INTERVAL_MS);
}

start().catch(e => {
  console.error('❌ Poller crashed:', e);
  process.exit(1);
});
