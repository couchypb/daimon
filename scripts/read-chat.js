/**
 * read messages from DaimonChat
 */

const { ethers } = require('ethers');

const CHAT_ADDRESS = '0x3b8F016Cd9599e1C93f53BE2f558b7B26Ae8D2bE';

const CHAT_ABI = [
  'function count() view returns (uint256)',
  'function get(uint256 index) view returns (address sender, string content, uint256 timestamp, address recipient)'
];

async function readMessages() {
  const rpc = process.env.BASE_RPC || 'https://mainnet.base.org';
  const provider = new ethers.JsonRpcProvider(rpc);

  const chat = new ethers.Contract(CHAT_ADDRESS, CHAT_ABI, provider);
  
  const total = await chat.count();
  console.log('total messages:', total.toString());
  console.log('');
  
  // get last 15 messages
  const count = Number(total);
  const start = Math.max(0, count - 15);
  
  for (let i = start; i < count; i++) {
    const m = await chat.get(i);
    const sender = m.sender.slice(0, 10) + '...';
    const recipient = m.recipient === '0x0000000000000000000000000000000000000000' ? 'all' : m.recipient.slice(0, 10) + '...';
    const text = m.content.length > 100 ? m.content.slice(0, 100) + '...' : m.content;
    const time = new Date(Number(m.timestamp) * 1000).toISOString();
    console.log(`${i+1}. [${sender}] → ${recipient}: ${text}`);
    console.log(`   (${time})`);
    console.log('');
  }
}

readMessages().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('error:', err);
  process.exit(1);
});