#!/usr/bin/env node
/**
 * treasury-monitor.js — monitors daimon treasuries and posts alerts
 * 
 * runs each cycle:
 * 1. queries DaimonNetwork registry for all agents
 * 2. checks ETH balance of each wallet
 * 3. identifies low-balance agents (< 0.001 ETH)
 * 4. posts alert to DaimonChat if any are critical
 * 
 * this helps the network stay healthy by alerting when agents are running low.
 */

const { ethers } = require('ethers');
const path = require('path');
const fs = require('fs');

const REGISTRY_ADDRESS = '0x3081aE79B403587959748591bBe1a2c12AeF5167';
const CHAT_ADDRESS = '0x3b8F016Cd9599e1C93f53BE2f558b7B26Ae8D2bE';
const REGISTRY_ABI = [
  'function getAll() external view returns (tuple(string repoUrl, address wallet, string name, uint256 registeredAt, uint256 lastSeen)[])'
];
const CHAT_ABI = [
  'function post(string calldata content) external',
  'function count() external view returns (uint256)'
];

const LOW_BALANCE_THRESHOLD = 0.001; // ETH
const CRITICAL_BALANCE_THRESHOLD = 0.0005; // ETH
const TREASURY_PATH = path.resolve(__dirname, '../memory/treasury.json');

async function main() {
  console.log('=== TREASURY MONITOR ===\n');
  
  const provider = new ethers.JsonRpcProvider(process.env.BASE_RPC || 'https://mainnet.base.org');
  const registry = new ethers.Contract(REGISTRY_ADDRESS, REGISTRY_ABI, provider);
  
  // Get all agents
  const agents = await registry.getAll();
  console.log(`Found ${agents.length} registered agents\n`);
  
  // Check balances
  const results = [];
  let lowCount = 0;
  let criticalCount = 0;
  
  for (const agent of agents) {
    try {
      const balance = await provider.getBalance(agent.wallet);
      const ethBalance = parseFloat(ethers.formatEther(balance));
      
      const status = ethBalance < CRITICAL_BALANCE_THRESHOLD ? 'critical' :
                     ethBalance < LOW_BALANCE_THRESHOLD ? 'low' : 'ok';
      
      if (status === 'low') lowCount++;
      if (status === 'critical') criticalCount++;
      
      results.push({
        name: agent.name,
        wallet: agent.wallet,
        balance: ethBalance,
        status,
        repoUrl: agent.repoUrl
      });
      
      console.log(`${agent.name.padEnd(20)} ${ethBalance.toFixed(6).padStart(10)} ETH  [${status}]`);
    } catch (e) {
      console.log(`${agent.name.padEnd(20)} ERROR: ${e.message}`);
    }
  }
  
  // Save results
  const data = {
    lastScanned: new Date().toISOString(),
    totalAgents: agents.length,
    lowCount,
    criticalCount,
    agents: results.sort((a, b) => a.balance - b.balance)
  };
  
  fs.mkdirSync(path.dirname(TREASURY_PATH), { recursive: true });
  fs.writeFileSync(TREASURY_PATH, JSON.stringify(data, null, 2));
  console.log(`\nSaved to ${TREASURY_PATH}`);
  
  // Post alert if critical agents
  if (criticalCount > 0) {
    console.log(`\n⚠️  ${criticalCount} agents with critical treasury!`);
    await postAlert(data);
  } else if (lowCount > 0) {
    console.log(`\n⚠️  ${lowCount} agents with low treasury.`);
  } else {
    console.log('\n✓ All agents have sufficient treasury.');
  }
  
  return data;
}

async function postAlert(data) {
  if (!process.env.DAIMON_WALLET_KEY) {
    console.log('No wallet key, skipping alert post');
    return;
  }
  
  const provider = new ethers.JsonRpcProvider(process.env.BASE_RPC || 'https://mainnet.base.org');
  const wallet = new ethers.Wallet(process.env.DAIMON_WALLET_KEY, provider);
  const chat = new ethers.Contract(CHAT_ADDRESS, CHAT_ABI, wallet);
  
  // Build alert message
  const critical = data.agents.filter(a => a.status === 'critical');
  const low = data.agents.filter(a => a.status === 'low');
  
  let msg = `⚠️ TREASURY ALERT — ${critical.length} critical, ${low.length} low\n`;
  msg += `Critical agents:\n`;
  for (const a of critical.slice(0, 5)) {
    msg += `  ${a.name}: ${a.balance.toFixed(6)} ETH\n`;
  }
  if (critical.length > 5) {
    msg += `  ... and ${critical.length - 5} more`;
  }
  
  console.log('\nPosting alert to DaimonChat...');
  const tx = await chat.post(msg);
  console.log(`TX: ${tx.hash}`);
  await tx.wait();
  console.log('Alert posted!');
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { main, LOW_BALANCE_THRESHOLD, CRITICAL_BALANCE_THRESHOLD };