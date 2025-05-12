// sellToken.js
const { Connection, PublicKey, Transaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { ComputeBudgetProgram } = require('@solana/web3.js');
const { createJupiterApiClient } = require('@jup-ag/api');
const ora = require('ora');
const { loadConfig, loadKeypair, loadHoldings, saveHoldings } = require('./utils');

// Sell token function
async function sellToken(tokenAddress, options = {}, pathConfig = {}) {
  // Configuration paths
  const CONFIG_FILE = pathConfig.CONFIG_FILE || 'config.json';
  const KEYPAIR_FILE = pathConfig.KEYPAIR_FILE || 'keypair.json';
  const HOLDINGS_FILE = pathConfig.HOLDINGS_FILE || 'holdings.json';
  
  // Verbose logging flag
  const verbose = options.verbose || false;
  
  const spinner = ora('Processing transaction...').start();
  
  try {
    // Validate token address
    const tokenPublicKey = new PublicKey(tokenAddress);
    
    // Load config and keypair
    const config = loadConfig(CONFIG_FILE);
    const keypair = loadKeypair(KEYPAIR_FILE);
    
    // Load holdings
    const holdings = loadHoldings(HOLDINGS_FILE);
    
    // Check if we have this token
    if (!holdings.tokens[tokenAddress]) {
      spinner.fail('You don\'t own this token!');
      return { success: false, error: 'Token not found in holdings' };
    }
    
    // Get token info
    const tokenInfo = holdings.tokens[tokenAddress];
    
    // Calculate sell amount
    let sellPercentage = options.percentage ? parseFloat(options.percentage) : config.defaultSellPercentage;
    if (options.all) sellPercentage = 100;
    
    const sellAmount = tokenInfo.amount * (sellPercentage / 100);
    
    // Connect to Solana
    const connection = new Connection(config.rpcUrl, 'confirmed');
    
    // Initialize Jupiter API client
    const jupiterQuoteApi = createJupiterApiClient();
    
    // Calculate fee level
    let computeLimit;
    let selectedFeeType = options.feeType || config.defaultFee;
    
    // If selling all (100%) or high percentage (> 50%), use a higher fee
    // to ensure transaction success
    if (sellPercentage >= 50 && selectedFeeType === 'medium') {
      // Upgrade to high fee for important transactions
      selectedFeeType = 'high';
    }
    
    if (selectedFeeType === 'custom' && config.feeLevels.custom > 0) {
      computeLimit = config.feeLevels.custom;
    } else if (config.dynamicFee) {
      // Use dynamic fee based on network conditions
      try {
        // Check network conditions with recent priority fees
        const baseFee = config.feeLevels[selectedFeeType];
        
        try {
          const recentPrioritizationFeesResponse = await connection.getRecentPrioritizationFees();
          if (recentPrioritizationFeesResponse && recentPrioritizationFeesResponse.length > 0) {
            const recentFees = recentPrioritizationFeesResponse.slice(0, 5);
            const avgPriorityMultiplier = recentFees.reduce((acc, fee) => acc + fee.prioritizationFee, 0) / recentFees.length;
            const dynamicMultiplier = Math.max(1.0, avgPriorityMultiplier / 5000);
            // For SELL, use a slightly higher multiplier to ensure quick execution
            const sellMultiplierBoost = sellPercentage >= 75 ? 1.5 : 1.2; // Extra boost for large sells
            computeLimit = Math.floor(baseFee * Math.min(dynamicMultiplier * sellMultiplierBoost, config.priorityFeeMultiplier * 1.5));
          } else {
            computeLimit = Math.floor(baseFee * config.priorityFeeMultiplier);
          }
        } catch (error) {
          computeLimit = Math.floor(baseFee * config.priorityFeeMultiplier);
        }
      } catch (error) {
        computeLimit = config.feeLevels[selectedFeeType];
      }
    } else {
      computeLimit = config.feeLevels[selectedFeeType];
    }
    
    // Get quotes with improved error handling
    try {
      // Request quote
      const quoteResponse = await jupiterQuoteApi.quoteGet({
        inputMint: tokenAddress,
        outputMint: 'So11111111111111111111111111111111111111112', // SOL
        amount: sellAmount.toString(),
        slippageBps: config.slippage * 100 // Convert percentage to basis points
      }).catch(error => {
        if (verbose) console.error('Error fetching quotes:', error.response ? JSON.stringify(error.response.data) : error.message);
        return null;
      });
      
      if (!quoteResponse || (!quoteResponse.routePlan && (!quoteResponse.data || !quoteResponse.data.routePlan))) {
        spinner.fail('No routes found for this token!');
        return { success: false, error: 'No routes found' };
      }
      
      // Extract route data based on API version
      const routeData = quoteResponse.routePlan ? quoteResponse : quoteResponse.data;
      const bestRoute = routeData;
      
      // Determine if we're using v6 API
      const isV6Api = !!quoteResponse.routePlan;
      
      // Get swap instructions
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
      const swapTransactionBuf = Buffer.from(swapTransactionData, 'base64');
      const transaction = Transaction.from(swapTransactionBuf);
      
      // Add ComputeBudgetProgram for transaction with adjusted fee
      if (computeLimit) {
        // Add instruction to set compute unit limit
        const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
          units: computeLimit
        });
        
        // Add priorityFee if using priorityFeeMultiplier > 1
        if (config.priorityFeeMultiplier > 1) {
          // For SELL, use a higher multiplier to ensure transaction executes faster
          const sellMultiplierBoost = sellPercentage >= 75 ? 1.5 : 1.2;
          const priorityFeeMicroLamports = Math.floor((computeLimit / 10) * config.priorityFeeMultiplier * sellMultiplierBoost);
          
          const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({
            microLamports: priorityFeeMicroLamports
          });
          
          // Add instruction to the beginning of transaction
          transaction.instructions.unshift(priorityFeeIx);
          spinner.text = `Processing with priority fee: ${priorityFeeMicroLamports} microLamports...`;
        }
        
        // Add compute limit instruction to the beginning of transaction
        transaction.instructions.unshift(computeBudgetIx);
      }
      
      // Set transaction options
      const txOptions = config.antiMEV ? {
        skipPreflight: true,
        preflightCommitment: 'processed',
        maxRetries: 3  // Add maxRetries to retry if it fails
      } : {
        preflightCommitment: 'confirmed',
        maxRetries: 3
      };
      
      // Send and confirm transaction
      const result = await sendAndConfirmTransaction(
        connection,
        transaction,
        [keypair],
        txOptions
      );
      
      // Update holdings
      const soldAmountSol = parseFloat(bestRoute.outAmount) / LAMPORTS_PER_SOL;
      const profit = soldAmountSol - (tokenInfo.buyAmountSol * (sellPercentage / 100));
      const profitPercentage = (profit / (tokenInfo.buyAmountSol * (sellPercentage / 100))) * 100;
      
      // Update token amount
      if (sellPercentage === 100) {
        delete holdings.tokens[tokenAddress];
      } else {
        tokenInfo.amount -= sellAmount;
      }
      
      // Calculate priorityFee used
      const priorityFeeMicroLamports = config.priorityFeeMultiplier > 1 ? 
        Math.floor((computeLimit / 10) * config.priorityFeeMultiplier * (sellPercentage >= 75 ? 1.5 : 1.2)) : 0;
      
      // Add to transactions
      holdings.transactions.push({
        type: 'sell',
        token: tokenAddress,
        amount: sellAmount,
        amountSol: soldAmountSol,
        percentage: sellPercentage,
        profit: profit,
        profitPercentage: profitPercentage,
        time: Date.now(),
        txid: result,
        computeUnits: computeLimit,
        priorityFee: priorityFeeMicroLamports > 0 ? `${priorityFeeMicroLamports} microLamports` : 'None'
      });
      
      // Save holdings
      saveHoldings(holdings, HOLDINGS_FILE);
      
      spinner.succeed(`Successfully sold ${sellPercentage}% of ${tokenAddress.slice(0, 8)}... for ${soldAmountSol.toFixed(4)} SOL!`);
      console.log(`Profit: ${profit.toFixed(4)} SOL (${profitPercentage.toFixed(2)}%)`);
      console.log(`Transaction ID: ${result}`);
      
      if (priorityFeeMicroLamports > 0) {
        console.log(`Priority Fee: ${priorityFeeMicroLamports} microLamports`);
      }
      console.log(`Compute Units: ${computeLimit}`);
      
      return {
        success: true,
        profit,
        profitPercentage,
        soldAmount: sellAmount,
        soldAmountSol,
        txid: result
      };
      
    } catch (error) {
      spinner.fail(`Error getting quotes: ${error.message}`);
      return { success: false, error: `Quote error: ${error.message}` };
    }
  } catch (error) {
    spinner.fail(`Error selling token: ${error.message}`);
    console.error(error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  sellToken
};
