// connectionManager.js
const { Connection } = require('@solana/web3.js');
const fs = require('fs');

// Singleton instance
let connectionInstance = null;

// Load config
function loadConfig(configPath = 'config.json') {
  try {
    const configData = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(configData);
  } catch (error) {
    console.error(`Error loading config from ${configPath}:`, error.message);
    return { rpcUrl: "https://api.mainnet-beta.solana.com" }; // Fallback
  }
}

/**
 * Get a reusable Solana connection instance
 * @param {boolean} forceRefresh Force creating a new connection
 * @param {string} configPath Path to config file
 * @param {string} commitment Commitment level ('processed', 'confirmed', 'finalized')
 * @returns {Connection} Solana connection instance
 */
function getConnection(forceRefresh = false, configPath = 'config.json', commitment = 'confirmed') {
  if (connectionInstance && !forceRefresh) {
    return connectionInstance;
  }

  // Load config to get RPC URL
  const config = loadConfig(configPath);
  const rpcUrl = config.rpcUrl || "https://api.mainnet-beta.solana.com";
  
  // Create new connection with specified commitment
  connectionInstance = new Connection(rpcUrl, commitment);
  
  return connectionInstance;
}

/**
 * Test the connection to ensure it's working
 * @param {boolean} verbose Whether to log detailed information
 * @returns {Promise<boolean>} Whether the connection is working
 */
async function testConnection(verbose = false) {
  try {
    const connection = getConnection();
    if (verbose) console.log('Checking RPC connection...');
    
    const blockchainInfo = await connection.getVersion();
    
    if (verbose) console.log('RPC Connection OK, Solana version:', blockchainInfo);
    return true;
  } catch (error) {
    console.error('RPC Connection Test Failed:', error.message);
    return false;
  }
}

module.exports = {
  getConnection,
  testConnection
};
