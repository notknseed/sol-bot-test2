// utils.js
const { PublicKey, Keypair } = require('@solana/web3.js');
const fs = require('fs');

// Helper function to load config
function loadConfig(CONFIG_FILE) {
  if (fs.existsSync(CONFIG_FILE)) {
    return JSON.parse(fs.readFileSync(CONFIG_FILE));
  }
  // Return default config
  return {
    rpcUrl: 'https://api.mainnet-beta.solana.com',
    feeLevels: {
      low: 5000,
      medium: 10000,
      high: 20000,
      urgent: 30000,
      custom: 0
    },
    defaultFee: 'medium',
    priorityFeeMultiplier: 1.0,
    dynamicFee: false,
    antiMEV: true,
    defaultBuyAmount: 0.1,
    defaultSellPercentage: 20,
    slippage: 1,
  };
}

// Helper function to load keypair
function loadKeypair(KEYPAIR_FILE) {
  const keypairData = JSON.parse(fs.readFileSync(KEYPAIR_FILE));
  return Keypair.fromSecretKey(new Uint8Array(keypairData.secretKey));
}

// Helper function to load holdings
function loadHoldings(HOLDINGS_FILE) {
  if (fs.existsSync(HOLDINGS_FILE)) {
    return JSON.parse(fs.readFileSync(HOLDINGS_FILE));
  }
  return { tokens: {}, transactions: [] };
}

// Helper function to save holdings
function saveHoldings(holdings, HOLDINGS_FILE) {
  fs.writeFileSync(HOLDINGS_FILE, JSON.stringify(holdings, null, 2));
}

// Get wallet address
function getWalletAddress(KEYPAIR_FILE) {
  const keypairData = JSON.parse(fs.readFileSync(KEYPAIR_FILE));
  return new PublicKey(keypairData.publicKey);
}

// Extract address from input (URL or direct address)
function extractAddressFromInput(input) {
  // Check if it's already a valid address
  if (isValidSolanaAddress(input)) {
    return input;
  }
  
  // Try to extract from URL (common patterns in DEX links)
  try {
    // Raydium format: https://raydium.io/swap/?inputCurrency=sol&outputCurrency=ADDRESS
    if (input.includes('raydium.io') && input.includes('outputCurrency=')) {
      return input.split('outputCurrency=')[1].split('&')[0];
    }
    
    // Jupiter format: https://jup.ag/swap/SOL-ADDRESS
    if (input.includes('jup.ag/swap/') && input.includes('-')) {
      return input.split('-')[1].split('/')[0].split('?')[0];
    }
    
    // Birdeye format: https://birdeye.so/token/ADDRESS
    if (input.includes('birdeye.so/token/')) {
      return input.split('/token/')[1].split('?')[0].split('/')[0];
    }
    
    // Fallback: Try to find any 32-44 character base58 string in the URL
    const matches = input.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/g);
    if (matches && matches.length > 0) {
      // Verify it's a valid public key
      try {
        new PublicKey(matches[0]);
        return matches[0];
      } catch (e) {
        return null;
      }
    }
  } catch (error) {
    return null;
  }
  
  return null;
}

// Check if string is a valid Solana address
function isValidSolanaAddress(str) {
  try {
    new PublicKey(str);
    return true;
  } catch (error) {
    return false;
  }
}

module.exports = {
  loadConfig,
  loadKeypair,
  loadHoldings,
  saveHoldings,
  getWalletAddress,
  extractAddressFromInput,
  isValidSolanaAddress
};
