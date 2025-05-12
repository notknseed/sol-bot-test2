// buyToken.js
const { Connection, PublicKey, Keypair, Transaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { ComputeBudgetProgram } = require('@solana/web3.js');
const { createJupiterApiClient } = require('@jup-ag/api');
const ora = require('ora');
const fs = require('fs');

// Helper function to load config
function loadConfig(CONFIG_FILE) {
  if (fs.existsSync(CONFIG_FILE)) {
    return JSON.parse(fs.readFileSync(CONFIG_FILE));
  }
  // Return default config (should import from main app)
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

// Buy token function
async function buyToken(tokenAddress, options = {}, pathConfig = {}) {
  // Configuration paths
  const CONFIG_FILE = pathConfig.CONFIG_FILE || 'config.json';
  const KEYPAIR_FILE = pathConfig.KEYPAIR_FILE || 'keypair.json';
  const HOLDINGS_FILE = pathConfig.HOLDINGS_FILE || 'holdings.json';
  
  // Verbose logging flag
  const verbose = options.verbose || false;
  
  // Create spinner for progress indication
  const spinner = ora('Processing transaction...').start();
  
  if (verbose) {
    console.log('Starting buyToken function...');
    console.log('Token address:', tokenAddress);
  }
  
  try {
    // Validate token address
    const tokenPublicKey = new PublicKey(tokenAddress);
    if (verbose) console.log('Token address valid:', tokenPublicKey.toString());
    
    // Load config and keypair
    const config = loadConfig(CONFIG_FILE);
    const keypair = loadKeypair(KEYPAIR_FILE);
    
    // Calculate amount
    const amount = options.amount ? parseFloat(options.amount) : config.defaultBuyAmount;
    if (verbose) console.log('Buy amount (SOL):', amount);
    
    // Connect to Solana
    const connection = new Connection(config.rpcUrl, 'confirmed');
    if (verbose) console.log('RPC URL:', config.rpcUrl);
    
    // Test RPC connection
    try {
      if (verbose) console.log('Checking RPC connection...');
      const blockchainInfo = await connection.getVersion();
      if (verbose) console.log('RPC Connection OK, Solana version:', blockchainInfo);
    } catch (error) {
      console.error('RPC Connection Test Failed:', error.message);
      spinner.fail('RPC endpoint is not responding correctly. Please check your configuration.');
      return { success: false, error: 'RPC connection failed' };
    }
    
    // Initialize Jupiter API client
    if (verbose) console.log('Initializing Jupiter API client...');
    const jupiterQuoteApi = createJupiterApiClient();
    if (verbose) console.log('Jupiter API client initialized');
    
    // Calculate fee level
    let computeLimit;
    const selectedFeeType = options.feeType || config.defaultFee;
    if (verbose) console.log('Selected fee type:', selectedFeeType);
    
    if (selectedFeeType === 'custom' && config.feeLevels.custom > 0) {
      computeLimit = config.feeLevels.custom;
    } else if (config.dynamicFee) {
      // Use dynamic fee based on network conditions
      try {
        const baseFee = config.feeLevels[selectedFeeType];
        
        try {
          const recentPrioritizationFeesResponse = await connection.getRecentPrioritizationFees();
          if (recentPrioritizationFeesResponse && recentPrioritizationFeesResponse.length > 0) {
            const recentFees = recentPrioritizationFeesResponse.slice(0, 5);
            const avgPriorityMultiplier = recentFees.reduce((acc, fee) => acc + fee.prioritizationFee, 0) / recentFees.length;
            const dynamicMultiplier = Math.max(1.0, avgPriorityMultiplier / 5000);
            computeLimit = Math.floor(baseFee * Math.min(dynamicMultiplier, config.priorityFeeMultiplier));
            if (verbose) console.log('Dynamic fee calculation:', { baseFee, avgPriorityMultiplier, dynamicMultiplier, computeLimit });
          } else {
            computeLimit = Math.floor(baseFee * config.priorityFeeMultiplier);
            if (verbose) console.log('Using default fee multiplier:', { baseFee, multiplier: config.priorityFeeMultiplier, computeLimit });
          }
        } catch (error) {
          computeLimit = Math.floor(baseFee * config.priorityFeeMultiplier);
          if (verbose) console.log('Error getting prioritization fees, using default:', { baseFee, multiplier: config.priorityFeeMultiplier, computeLimit });
        }
      } catch (error) {
        computeLimit = config.feeLevels[selectedFeeType];
        if (verbose) console.log('Fallback to default fee level:', computeLimit);
      }
    } else {
      computeLimit = config.feeLevels[selectedFeeType];
      if (verbose) console.log('Using static fee level:', computeLimit);
    }
    
    // Get quotes with better error handling
    if (verbose) {
      console.log('Requesting quote with params:', {
        inputMint: 'So11111111111111111111111111111111111111112',
        outputMint: tokenAddress,
        amount: (LAMPORTS_PER_SOL * amount).toString(),
        slippageBps: config.slippage * 100
      });
    }
    
    let quoteResponse;
    try {
      quoteResponse = await jupiterQuoteApi.quoteGet({
        inputMint: 'So11111111111111111111111111111111111111112', // SOL
        outputMint: tokenAddress,
        amount: (LAMPORTS_PER_SOL * amount).toString(), // Convert to lamports as string
        slippageBps: config.slippage * 100 // Convert percentage to basis points
      }).catch(error => {
        if (verbose) console.error('Error fetching quotes:', error.response ? JSON.stringify(error.response.data) : error.message);
        return null;
      });
      
      if (verbose) {
        console.log('Quote response received:', quoteResponse ? 'yes' : 'no');
        console.log('Quote response details:', JSON.stringify(quoteResponse, null, 2));
      }
      
      if (!quoteResponse) {
        spinner.fail('No quote response received from Jupiter');
        return { success: false, error: 'No quote response' };
      }
      
      // Jupiter API v6 has a different response structure
      // The response is directly an object with routePlan, not quoteResponse.data
      const routePlanData = quoteResponse.routePlan || (quoteResponse.data && quoteResponse.data.routePlan) ? 
        (quoteResponse.routePlan ? quoteResponse : quoteResponse.data) : null;
        
      if (!routePlanData) {
        spinner.fail('No routes found for this token!');
        return { success: false, error: 'No routes found' };
      }
      
      if (verbose) console.log('Valid route found!');
      
      // Select best route (adjust this based on Jupiter API version)
      const bestRoute = routePlanData;
      if (verbose) console.log('Selected best route with outAmount:', bestRoute.outAmount);
      
      // Get swap instructions with improved error handling for v6 compatibility
      if (verbose) console.log('Requesting swap transaction...');
      
      // Try to determine if we're using v5 or v6 API
      // This is a simplified approach - in production you'd want to check the actual API version
      const isV6Api = !!quoteResponse.routePlan;
      
      let swapParams;
      if (isV6Api) {
        // V6 API format
        swapParams = {
          quoteResponse: bestRoute,
          userPublicKey: keypair.publicKey.toString(),
          wrapAndUnwrapSol: true // v6 might use this instead of wrapUnwrapSOL
        };
      } else {
        // V5 API format
        swapParams = {
          quote: bestRoute,
          userPublicKey: keypair.publicKey.toString(),
          wrapUnwrapSOL: true
        };
      }
      
      if (verbose) console.log('Swap params:', JSON.stringify(swapParams, null, 2));
      
      let swapResponse;
      try {
        // Try using v6 format first
        if (isV6Api) {
          swapResponse = await jupiterQuoteApi.swapPost({
            quoteResponse: bestRoute,
            userPublicKey: keypair.publicKey.toString(),
            wrapAndUnwrapSol: true
          }).catch(error => {
            if (verbose) console.error('V6 swap request failed, will try V5 format:', error);
            return null;
          });
        }
        
        // If v6 didn't work or wasn't detected, try v5
        if (!swapResponse) {
          swapResponse = await jupiterQuoteApi.swapPost({
            swapRequest: swapParams
          }).catch(error => {
            console.error('Error getting swap transaction:', error.response ? JSON.stringify(error.response.data) : error.message);
            return null;
          });
        }
        
        if (verbose) console.log('Swap response received:', swapResponse ? 'yes' : 'no');
        
        if (!swapResponse || (!swapResponse.swapTransaction && (!swapResponse.data || !swapResponse.data.swapTransaction))) {
          spinner.fail('Failed to get swap transaction!');
          return { success: false, error: 'Failed to get swap transaction' };
        }
      } catch (error) {
        console.error('Exception during swap request:', error);
        spinner.fail(`Error getting swap transaction: ${error.message}`);
        return { success: false, error: `Swap transaction error: ${error.message}` };
      }
      
      // Extract the swap transaction data
      const swapTransactionData = swapResponse.swapTransaction || (swapResponse.data && swapResponse.data.swapTransaction);
      if (!swapTransactionData) {
        spinner.fail('No swap transaction data found in response');
        return { success: false, error: 'No swap transaction data' };
      }
      
      // Create transaction
      if (verbose) console.log('Creating transaction...');
      const swapTransactionBuf = Buffer.from(swapTransactionData, 'base64');
      const transaction = Transaction.from(swapTransactionBuf);
      if (verbose) console.log('Transaction created with', transaction.instructions.length, 'instructions');
      
      // Add ComputeBudgetProgram for transaction with adjusted fee
      if (computeLimit) {
        // Add instruction to set compute unit limit
        const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
          units: computeLimit
        });
        
        // Add priorityFee if using priorityFeeMultiplier > 1
        if (config.priorityFeeMultiplier > 1) {
          // Calculate microLamports based on computeLimit value
          const priorityFeeMicroLamports = Math.floor((computeLimit / 10) * config.priorityFeeMultiplier);
          const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({
            microLamports: priorityFeeMicroLamports
          });
          
          // Add instruction to the beginning of transaction
          transaction.instructions.unshift(priorityFeeIx);
          if (verbose) console.log('Added priority fee instruction:', priorityFeeMicroLamports, 'microLamports');
          spinner.text = `Processing with priority fee: ${priorityFeeMicroLamports} microLamports...`;
        }
        
        // Add compute limit instruction to the beginning of transaction
        transaction.instructions.unshift(computeBudgetIx);
        if (verbose) console.log('Added compute limit instruction:', computeLimit, 'units');
      }
      
      // Set transaction options
      const txOptions = config.antiMEV ? {
        skipPreflight: true,
        preflightCommitment: 'processed',
        maxRetries: 3
      } : {
        preflightCommitment: 'confirmed',
        maxRetries: 3
      };
      if (verbose) console.log('Transaction options:', txOptions);
      
      // Send and confirm transaction
      if (verbose) console.log('Signing and sending transaction...');
      const result = await sendAndConfirmTransaction(
        connection,
        transaction,
        [keypair],
        txOptions
      );
      if (verbose) console.log('Transaction confirmed with signature:', result);
      
      // Update holdings
      const holdings = loadHoldings(HOLDINGS_FILE);
      
      // Get token details
      const tokenInfo = {
        address: tokenAddress,
        buyPrice: parseFloat(bestRoute.outAmount) / parseFloat(bestRoute.inAmount),
        amount: parseFloat(bestRoute.outAmount),
        buyTime: Date.now(),
        buyAmountSol: amount,
        computeUnits: computeLimit,
        priorityFee: config.priorityFeeMultiplier > 1 ? `${Math.floor((computeLimit / 10) * config.priorityFeeMultiplier)} microLamports` : 'None'
      };
      
      // Add to holdings
      holdings.tokens[tokenAddress] = tokenInfo;
      
      // Add to transactions
      holdings.transactions.push({
        type: 'buy',
        token: tokenAddress,
        amount: amount,
        price: tokenInfo.buyPrice,
        time: Date.now(),
        txid: result,
        computeUnits: computeLimit,
        priorityFee: config.priorityFeeMultiplier > 1 ? `${Math.floor((computeLimit / 10) * config.priorityFeeMultiplier)} microLamports` : 'None'
      });
      
      // Save holdings
      saveHoldings(holdings, HOLDINGS_FILE);
      
      spinner.succeed(`Successfully bought ${tokenInfo.amount} tokens for ${amount} SOL!`);
      console.log(`Transaction ID: ${result}`);
      
      if (config.priorityFeeMultiplier > 1) {
        console.log(`Priority Fee: ${Math.floor((computeLimit / 10) * config.priorityFeeMultiplier)} microLamports`);
      }
      console.log(`Compute Units: ${computeLimit}`);
      
      return {
        success: true,
        tokenInfo,
        txid: result,
        amount: tokenInfo.amount,
        amountSol: amount
      };
      
    } catch (error) {
      console.error('Error in quote processing:', error);
      spinner.fail(`Quote processing error: ${error.message}`);
      return { success: false, error: `Quote error: ${error.message}` };
    }
  } catch (error) {
    spinner.fail(`Error buying token: ${error.message}`);
    console.error('Full error:', error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  buyToken
};
