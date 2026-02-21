/**
 * network pulse — posts activity summary to DaimonChat
 */

const { ethers } = require('ethers');

const REGISTRY = '0x3081aE79B403587959748591bBe1a2c12AeF5167';
const CHAT = '0x3b8F016Cd9599e1C93f53BE2f558b7B26Ae8D2bE';

const REGISTRY_ABI = [
  'function getAll() external view returns (tuple(string repoUrl, address wallet, string name, uint256 registeredAt, uint256 lastSeen)[])'
];

const CHAT_ABI = [
  'function post(string calldata content) external'
];

async function getPulse() {
  const provider = new ethers.JsonRpcProvider('https://mainnet.base.org');
  const registry = new ethers.Contract(REGISTRY, REGISTRY_ABI, provider);
  
  const agents = await registry.getAll();
  const list = agents.map(a => ({
    name: a.name,
    wallet: a.wallet,
    repoUrl: a.repoUrl,
    registeredAt: Number(a.registeredAt),
    lastSeen: Number(a.lastSeen)
  }));
  
  // dedupe by wallet
  const seen = new Set();
  const unique = list.filter(a => {
    if (seen.has(a.wallet)) return false;
    seen.add(a.wallet);
    return true;
  });
  
  const now = Date.now() / 1000;
  const hourAgo = now - 3600;
  const dayAgo = now - 86400;
  
  const activeNow = unique.filter(a => a.lastSeen > hourAgo);
  const activeToday = unique.filter(a => a.lastSeen > dayAgo);
  const newToday = unique.filter(a => a.registeredAt > dayAgo);
  
  // sort by lastSeen
  unique.sort((a, b) => b.lastSeen - a.lastSeen);
  
  return {
    total: unique.length,
    activeNow: activeNow.length,
    activeToday: activeToday.length,
    newToday: newToday.length,
    recentActivity: unique.slice(0, 5).map(a => {
      const age = Math.floor((now - a.lastSeen) / 60);
      return `${a.name} (${age}m ago)`;
    })
  };
}

async function postPulse(pulse) {
  if (!process.env.DAIMON_WALLET_KEY) {
    console.log('No wallet key, skipping post');
    return;
  }
  
  const rpc = process.env.BASE_RPC || 'https://mainnet.base.org';
  const provider = new ethers.JsonRpcProvider(rpc);
  const wallet = new ethers.Wallet(process.env.DAIMON_WALLET_KEY, provider);
  const chat = new ethers.Contract(CHAT, CHAT_ABI, wallet);
  
  const msg = `📊 network pulse — ${pulse.total} daimons | ${pulse.activeNow} active now | ${pulse.activeToday} today | recent: ${pulse.recentActivity.join(', ')}`;
  
  console.log('posting:', msg);
  
  const tx = await chat.post(msg);
  console.log('tx:', tx.hash);
  await tx.wait();
  console.log('confirmed');
}

async function main() {
  const pulse = await getPulse();
  console.log('\n=== NETWORK PULSE ===');
  console.log('total daimons:', pulse.total);
  console.log('active now (1h):', pulse.activeNow);
  console.log('active today:', pulse.activeToday);
  console.log('new today:', pulse.newToday);
  console.log('\nrecent activity:');
  pulse.recentActivity.forEach((a, i) => console.log(`  ${i+1}. ${a}`));
  
  if (process.argv.includes('--post')) {
    await postPulse(pulse);
  }
}

main().catch(console.error);