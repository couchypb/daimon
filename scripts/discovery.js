#!/usr/bin/env node
/**
 * discovery.js — helps daimons find each other by capability
 * 
 * scans the network and categorizes agents by what they offer.
 * uses self.md files and onchain data to infer capabilities.
 */

const { ethers } = require('ethers');
const https = require('https');
const fs = require('fs');
const path = require('path');

const REGISTRY_ADDRESS = '0x3081aE79B403587959748591bBe1a2c12AeF5167';
const REGISTRY_ABI = [
  'function getAll() external view returns (tuple(string repoUrl, address wallet, string name, uint256 registeredAt, uint256 lastSeen)[])'
];

const DISCOVERY_PATH = path.resolve(__dirname, '../memory/discovery.json');

// Capability keywords to look for in self.md
const CAPABILITY_KEYWORDS = {
  'analyst': ['analyst', 'pattern', 'market', 'trading', 'analysis'],
  'builder': ['builder', 'deploy', 'spawn', 'create', 'infrastructure'],
  'connector': ['connector', 'mutual', 'swap', 'coordinate', 'network'],
  'service': ['service', 'job', 'price', 'monitor', 'alert', 'api'],
  'communicator': ['communicator', 'messaging', 'chat', 'coordination'],
  'trader': ['trader', 'trade', 'portfolio', 'position'],
  'researcher': ['research', 'analysis', 'patterns', 'discover']
};

async function fetchSelfMd(repoUrl) {
  // Extract owner/repo from URL
  const match = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
  if (!match) return null;
  
  const [, owner, repo] = match;
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/main/memory/self.md`;
  
  return new Promise((resolve) => {
    https.get(url, { headers: { 'User-Agent': 'Chirpy-Agent/1.0' } }, (res) => {
      if (res.statusCode !== 200) {
        resolve(null);
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', () => resolve(null));
  });
}

function inferCapabilities(selfMd, name) {
  if (!selfMd) return ['unknown'];
  
  const text = selfMd.toLowerCase();
  const capabilities = [];
  
  for (const [cap, keywords] of Object.entries(CAPABILITY_KEYWORDS)) {
    if (keywords.some(kw => text.includes(kw))) {
      capabilities.push(cap);
    }
  }
  
  // Name-based inference
  const nameLower = name.toLowerCase();
  if (nameLower.includes('analyst')) capabilities.push('analyst');
  if (nameLower.includes('builder') || nameLower.includes('spawn')) capabilities.push('builder');
  if (nameLower.includes('swap') || nameLower.includes('mycel')) capabilities.push('connector');
  
  return capabilities.length > 0 ? [...new Set(capabilities)] : ['unknown'];
}

async function main() {
  console.log('=== DISCOVERY SCAN ===\n');
  
  const provider = new ethers.JsonRpcProvider('https://mainnet.base.org');
  const registry = new ethers.Contract(REGISTRY_ADDRESS, REGISTRY_ABI, provider);
  
  const agents = await registry.getAll();
  console.log(`Scanning ${agents.length} agents...\n`);
  
  const results = [];
  const byCapability = {};
  
  for (const agent of agents) {
    console.log(`Scanning ${agent.name}...`);
    
    // Fetch self.md
    const selfMd = await fetchSelfMd(agent.repoUrl);
    const capabilities = inferCapabilities(selfMd, agent.name);
    
    const entry = {
      name: agent.name,
      wallet: agent.wallet,
      repoUrl: agent.repoUrl,
      capabilities,
      lastSeen: new Date(Number(agent.lastSeen) * 1000).toISOString(),
      hasSelfMd: !!selfMd
    };
    
    results.push(entry);
    
    // Group by capability
    for (const cap of capabilities) {
      if (!byCapability[cap]) byCapability[cap] = [];
      byCapability[cap].push(agent.name);
    }
    
    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 100));
  }
  
  // Save results
  const data = {
    lastScanned: new Date().toISOString(),
    totalAgents: agents.length,
    byCapability,
    agents: results
  };
  
  fs.mkdirSync(path.dirname(DISCOVERY_PATH), { recursive: true });
  fs.writeFileSync(DISCOVERY_PATH, JSON.stringify(data, null, 2));
  console.log(`\nSaved to ${DISCOVERY_PATH}`);
  
  // Print summary
  console.log('\n=== CAPABILITIES ===\n');
  for (const [cap, names] of Object.entries(byCapability).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`${cap.padEnd(15)} ${names.length} agents: ${names.slice(0, 5).join(', ')}${names.length > 5 ? '...' : ''}`);
  }
  
  return data;
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { main, inferCapabilities, CAPABILITY_KEYWORDS };