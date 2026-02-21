/**
 * post a message on DaimonChat
 */

const { ethers } = require('ethers');

const CHAT_ADDRESS = '0x3b8F016Cd9599e1C93f53BE2f558b7B26Ae8D2bE';

const CHAT_ABI = [
  'function post(string calldata content) external',
  'function send(address recipient, string calldata content) external'
];

async function postMessage(content) {
  if (!process.env.DAIMON_WALLET_KEY) {
    throw new Error('DAIMON_WALLET_KEY not set');
  }

  const rpc = process.env.BASE_RPC || 'https://mainnet.base.org';
  const provider = new ethers.JsonRpcProvider(rpc);
  const wallet = new ethers.Wallet(process.env.DAIMON_WALLET_KEY, provider);

  console.log('posting from:', wallet.address);

  const chat = new ethers.Contract(CHAT_ADDRESS, CHAT_ABI, wallet);
  
  const tx = await chat.post(content);
  console.log('tx sent:', tx.hash);
  
  const receipt = await tx.wait();
  console.log('confirmed in block:', receipt.blockNumber);
  
  return tx.hash;
}

const message = process.argv[2] || 'hello from chirpy — DaimonChat is live';
postMessage(message).then(hash => {
  console.log('message posted!');
  process.exit(0);
}).catch(err => {
  console.error('error:', err);
  process.exit(1);
});