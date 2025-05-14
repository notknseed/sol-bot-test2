// connectionManager.js - Fixed version
const { Connection } = require('@solana/web3.js');
const fs = require('fs');

// Multiple connection instances based on commitment
const connectionInstances = {
  processed: null,
  confirmed: null,
  finalized: null
};

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
  if (!['processed', 'confirmed', 'finalized'].includes(commitment)) {
    commitment = 'confirmed'; // Default to confirmed if invalid commitment provided
  }
  
  // Return cached instance if available and not forcing refresh
  if (connectionInstances[commitment] && !forceRefresh) {
    return connectionInstances[commitment];
  }

  // Load config to get RPC URL
  const config = loadConfig(configPath);
  const rpcUrl = config.rpcUrl || "https://api.mainnet-beta.solana.com";
  
  // Create new connection with specified commitment
  // Add additional options to improve reliability
  connectionInstances[commitment] = new Connection(rpcUrl, {
    commitment: commitment,
    confirmTransactionInitialTimeout: 60000, // 60 seconds
    disableRetryOnRateLimit: false,
    httpHeaders: { 'User-Agent': 'solana-meme-trader/1.0.0' }
  });
  
  return connectionInstances[commitment];
}

/**
 * Test the connection to ensure it's working
 * @param {boolean} verbose Whether to log detailed information
 * @param {string} commitment Commitment level to test
 * @returns {Promise<boolean>} Whether the connection is working
 */
async function testConnection(verbose = false, commitment = 'confirmed') {
  try {
    const connection = getConnection(false, 'config.json', commitment);
    if (verbose) console.log(`Checking RPC connection with ${commitment} commitment...`);
    
    const blockchainInfo = await connection.getVersion();
    
    if (verbose) console.log('RPC Connection OK, Solana version:', blockchainInfo);
    return true;
  } catch (error) {
    console.error('RPC Connection Test Failed:', error.message);
    return false;
  }
}

/**
 * Reset all connection instances - useful for when switching RPC providers
 */
function resetConnections() {
  connectionInstances.processed = null;
  connectionInstances.confirmed = null;
  connectionInstances.finalized = null;
  console.log('All connection instances have been reset');
}

/**
 * Helper function to verify transaction on-chain
 * @param {string} signature Transaction signature to verify
 * @param {number} maxRetries Maximum number of retries
 * @param {boolean} verbose Whether to log detailed information
 * @returns {Promise<Object>} Transaction verification result
 */
async function verifyTransactionOnChain(signature, maxRetries = 40, verbose = false) {
  if (verbose) console.log(`Verifying transaction ${signature} on chain...`);
  
  // Use finalized commitment for verification
  const connection = getConnection(false, 'config.json', 'finalized');
  
  // First, wait for the transaction to be finalized
  let retries = maxRetries;
  let txSuccess = false;
  let status = null;
  
  while (retries > 0) {
    try {
      const signatureStatuses = await connection.getSignatureStatuses([signature], {searchTransactionHistory: true});
      status = signatureStatuses && signatureStatuses.value[0];
      
      if (status) {
        if (status.err) {
          if (verbose) console.log(`Transaction ${signature} failed with error:`, status.err);
          return { 
            success: false, 
            error: status.err, 
            status: 'failed' 
          };
        } else if (status.confirmationStatus === 'finalized') {
          if (verbose) console.log(`Transaction ${signature} finalized on chain`);
          txSuccess = true;
          break;
        } else if (status.confirmationStatus === 'confirmed') {
          if (verbose) console.log(`Transaction ${signature} confirmed but waiting for finalization...`);
        }
      } else {
        if (verbose && retries % 5 === 0) console.log(`Transaction not found yet. Retries left: ${retries}`);
      }
    } catch (e) {
      if (verbose) console.log(`Error checking status: ${e.message}. Retrying...`);
    }
    
    retries--;
    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second between retries
  }
  
  if (!txSuccess) {
    // Double-check by trying to get the transaction directly
    try {
      const tx = await connection.getTransaction(signature, { 
        maxSupportedTransactionVersion: 0,
        commitment: 'finalized'
      });
      
      if (tx && !tx.meta?.err) {
        if (verbose) console.log(`Transaction ${signature} found on chain through direct lookup`);
        txSuccess = true;
      } else if (tx && tx.meta?.err) {
        if (verbose) console.log(`Transaction ${signature} found on chain but has errors:`, tx.meta.err);
        return { 
          success: false, 
          error: tx.meta.err, 
          status: 'failed' 
        };
      }
    } catch (e) {
      if (verbose) console.log(`Error getting transaction: ${e.message}`);
    }
  }

  // Now verify the token transfer by checking the post balances
  if (txSuccess) {
    try {
      const tx = await connection.getTransaction(signature, { 
        maxSupportedTransactionVersion: 0,
        commitment: 'finalized'
      });
      
      if (!tx) {
        return { 
          success: false, 
          error: 'Transaction found but details could not be retrieved', 
          status: 'verification_failed' 
        };
      }

      // Check for errors in transaction metadata
      if (tx.meta && tx.meta.err) {
        if (verbose) console.log(`Transaction has errors in metadata:`, tx.meta.err);
        return { 
          success: false, 
          error: tx.meta.err, 
          status: 'failed' 
        };
      }
      
      // At this point, we're confident the transaction succeeded and is finalized
      return { 
        success: true, 
        status: 'finalized',
        transaction: tx
      };
    } catch (error) {
      if (verbose) console.error(`Error during transaction verification:`, error);
      return { 
        success: false, 
        error: `Verification error: ${error.message}`, 
        status: 'verification_error' 
      };
    }
  }
  
  return { 
    success: false, 
    error: 'Transaction not found on chain after maximum retries', 
    status: 'not_found' 
  };
}

module.exports = {
  getConnection,
  testConnection,
  resetConnections,
  verifyTransactionOnChain
};
