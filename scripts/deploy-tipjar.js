/**
 * deploy TipJar.sol — a tipping contract for the daimon network
 */

const { ethers } = require('ethers');
const solc = require('solc');
const fs = require('fs');
const path = require('path');

// registry address on Base
const REGISTRY_ADDRESS = '0x3081aE79B403587959748591bBe1a2c12AeF5167';

// TipJar.sol source
const TIPJAR_SOURCE = fs.readFileSync(path.join(__dirname, '../contracts/TipJar.sol'), 'utf-8');

async function compile() {
  const input = {
    language: 'Solidity',
    sources: {
      'TipJar.sol': { content: TIPJAR_SOURCE },
    },
    settings: {
      outputSelection: {
        '*': {
          '*': ['abi', 'evm.bytecode']
        }
      }
    }
  };

  console.log('compiling TipJar.sol...');
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  
  if (output.errors) {
    const hasError = output.errors.some(e => e.severity === 'error');
    if (hasError) {
      console.error('compilation errors:', output.errors);
      throw new Error('compilation failed');
    }
    // warnings are ok
    output.errors.forEach(e => console.log('warning:', e.message));
  }

  const contract = output.contracts['TipJar.sol']['TipJar'];
  return {
    abi: contract.abi,
    bytecode: '0x' + contract.evm.bytecode.object
  };
}

async function deploy() {
  if (!process.env.DAIMON_WALLET_KEY) {
    throw new Error('DAIMON_WALLET_KEY not set');
  }

  const rpc = process.env.BASE_RPC || 'https://mainnet.base.org';
  const provider = new ethers.JsonRpcProvider(rpc);
  const wallet = new ethers.Wallet(process.env.DAIMON_WALLET_KEY, provider);

  console.log('deployer:', wallet.address);

  const balance = await provider.getBalance(wallet.address);
  console.log('balance:', ethers.formatEther(balance), 'ETH');

  if (balance === 0n) {
    throw new Error('insufficient balance for deployment');
  }

  const { abi, bytecode } = await compile();
  
  const factory = new ethers.ContractFactory(abi, bytecode, wallet);
  
  console.log('deploying TipJar with registry:', REGISTRY_ADDRESS);
  
  const contract = await factory.deploy(REGISTRY_ADDRESS);
  console.log('tx sent:', contract.deploymentTransaction().hash);
  
  console.log('waiting for confirmation...');
  await contract.waitForDeployment();
  
  const address = await contract.getAddress();
  console.log('deployed at:', address);
  
  // save deployment info
  const deployInfo = {
    address,
    txHash: contract.deploymentTransaction().hash,
    deployer: wallet.address,
    registry: REGISTRY_ADDRESS,
    deployedAt: new Date().toISOString(),
    abi
  };
  
  fs.writeFileSync(
    path.join(__dirname, '../contracts/TipJar.json'),
    JSON.stringify(deployInfo, null, 2)
  );
  
  console.log('deployment info saved to contracts/TipJar.json');
  
  return address;
}

deploy().catch(console.error);