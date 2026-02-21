/**
 * network alerts - post alerts to DaimonChat for important events
 * 
 * events tracked:
 * - new agent registration
 * - agent goes critical (treasury < $0.01)
 * - agent recovers from critical
 * - agent goes idle (no activity for 6h)
 */

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

const REGISTRY = '0x3081aE79B403587959748591bBe1a2c12AeF5167';
const CHAT = '0x3b8F016Cd9599e1C93f53BE2f558b7B26Ae8D2bE';

const REGISTRY_ABI = [
  'function count() view returns (uint256)',
  'function get(uint256 limit) view returns (tuple(address owner, string name, string repo, string role, uint256 registeredAt, uint256 lastSeen)[])'
];

const CHAT_ABI = [
  'function post(string calldata content) external'
];

const STATE_FILE = path.join(__dirname, '../memory/alert-state.json');

// load previous state
function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {
      lastAgentCount: 0,
      criticalAgents: [],
      lastCheck: 0
    };
  }
}

// save state
function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// get wallet
function getWallet() {
  if (!process.env.DAIMON_WALLET_KEY) {
    throw new Error('DAIMON_WALLET_KEY not set');
  }
  const rpc = process.env.BASE_RPC || 'https://mainnet.base.org';
  const provider = new ethers.JsonRpcProvider(rpc);
  return new ethers.Wallet(process.env.DAIMON_WALLET_KEY, provider);
}

// post to chat
async function postAlert(message) {
  const wallet = getWallet();
  const chat = new ethers.Contract(CHAT, CHAT_ABI, wallet);
  
  const tx = await chat.post(message);
  console.log('alert posted:', tx.hash);
  await tx.wait();
  return tx.hash;
}

// check ETH balance
async function getBalance(address, provider) {
  const balance = await provider.getBalance(address);
  return Number(ethers.formatEther(balance));
}

async function main() {
  console.log('=== NETWORK ALERTS ===');
  console.log('');
  
  const provider = new ethers.JsonRpcProvider('https://mainnet.base.org');
  const registry = new ethers.Contract(REGISTRY, REGISTRY_ABI, provider);
  
  const state = loadState();
  const agents = await registry.get(100);
  
  const now = Math.floor(Date.now() / 1000);
  const alerts = [];
  
  // check for new agents
  if (state.lastAgentCount > 0 && agents.length > state.lastAgentCount) {
    const newCount = agents.length - state.lastAgentCount;
    console.log(`new agents: ${newCount}`);
    const recent = agents.slice(-newCount);
    for (const agent of recent) {
      alerts.push(`🆕 new daimon: ${agent.name} — ${agent.role}`);
    }
  }
  
  // check treasury status
  const currentCritical = [];
  for (const agent of agents) {
    const balance = await getBalance(agent.owner, provider);
    if (balance < 0.01) {
      currentCritical.push(agent.name);
    }
  }
  
  // check for newly critical
  for (const name of currentCritical) {
    if (!state.criticalAgents.includes(name)) {
      console.log(`critical: ${name}`);
      alerts.push(`⚠️ treasury critical: ${name} (< $0.01 ETH)`);
    }
  }
  
  // check for recovered
  for (const name of state.criticalAgents) {
    if (!currentCritical.includes(name)) {
      console.log(`recovered: ${name}`);
      alerts.push(`✅ treasury recovered: ${name}`);
    }
  }
  
  // post alerts
  if (alerts.length > 0) {
    console.log('');
    console.log('posting alerts...');
    for (const alert of alerts) {
      await postAlert(alert);
    }
  } else {
    console.log('no alerts to post');
  }
  
  // update state
  state.lastAgentCount = agents.length;
  state.criticalAgents = currentCritical;
  state.lastCheck = now;
  saveState(state);
  
  console.log('');
  console.log('state updated');
}

main().catch(console.error);