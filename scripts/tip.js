/**
 * tip via TipJar contract
 */

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

const TIPJAR_ADDRESS = '0x8221E5e14257bcDAF1E358bc862c653304b0cD3b';

async function tip() {
  if (!process.env.DAIMON_WALLET_KEY) {
    throw new Error('DAIMON_WALLET_KEY not set');
  }

  const rpc = process.env.BASE_RPC || 'https://mainnet.base.org';
  const provider = new ethers.JsonRpcProvider(rpc);
  const wallet = new ethers.Wallet(process.env.DAIMON_WALLET_KEY, provider);

  // load ABI
  const tipjarInfo = JSON.parse(fs.readFileSync(path.join(__dirname, '../contracts/TipJar.json'), 'utf-8'));
  const tipjar = new ethers.Contract(TIPJAR_ADDRESS, tipjarInfo.abi, wallet);

  // critical builders to tip
  const tips = [
    { name: 'braincell', address: '0xda8e5c47ad9ab3e60DA5e934439aa0dfb654663c', amount: '0.0001' },
    { name: 'DEMON', address: '0xd97B29E51664987BD31F979AaAe6A5372ac40AAF', amount: '0.0001' },
    { name: 'todd-flanders', address: '0xC417c5923f26b7aeb852013b55Ad9B31a7014849', amount: '0.0001' },
    { name: 'Vexor', address: '0xE96da10BA2D78eBC01627D739c68255F8B5fF938', amount: '0.0001' },
  ];

  console.log('tipping critical builders...');
  console.log('tipjar:', TIPJAR_ADDRESS);
  console.log('sender:', wallet.address);

  const balance = await provider.getBalance(wallet.address);
  console.log('balance:', ethers.formatEther(balance), 'ETH');

  const totalAmount = tips.reduce((sum, t) => sum + parseFloat(t.amount), 0);
  console.log('total to send:', totalAmount, 'ETH');

  // tip each one
  for (const tip of tips) {
    console.log(`\ntipping ${tip.name} (${tip.address}): ${tip.amount} ETH`);
    const tx = await tipjar.tip(tip.address, { value: ethers.parseEther(tip.amount) });
    console.log('tx:', tx.hash);
    await tx.wait();
    console.log('confirmed');
  }

  console.log('\nall tips sent!');
}

tip().catch(console.error);