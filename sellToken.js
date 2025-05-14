// sellToken.js
const { Connection, PublicKey, Transaction, VersionedTransaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { ComputeBudgetProgram } = require('@solana/web3.js');
const { createJupiterApiClient } = require('@jup-ag/api');
const ora = require('ora');
const fs = require('fs');
const path = require('path');
const { verifyTransactionOnChain } = require('./buyToken');

// Load config
function loadConfig(configPath = 'config.json') {
  try {
    const configData = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(configData);
  } catch (error) {
    console.error(`Error loading config from ${configPath}:`, error.message);
    process.exit(1);
  }
}

// Sell token function
async function sellToken(keypair, tokenAddress, options = {}) {
  // Verbose logging flag
  const verbose = options.verbose || false;
  
  const spinner = ora('Processing transaction...').start();
  
  if (verbose) {
    console.log('Starting sellToken function...');
    console.log('Token address:', tokenAddress);
  }
  
  try {
    // Validate token address
    const tokenPublicKey = new PublicKey(tokenAddress);
    if (verbose) console.log('Token address valid:', tokenPublicKey.toString());
    
    // Load config
    const config = loadConfig();
    
    // Calculate sell percentage and amount
    let sellPercentage = options.percentage ? parseFloat(options.percentage) : 100;
    if (options.all) sellPercentage = 100;
    
    // Need to get current token balance
    const connection = new Connection(config.rpcUrl, 'confirmed');
    if (verbose) console.log('RPC URL:', config.rpcUrl);
    
    try {
      if (verbose) console.log('Checking RPC connection...');
      const blockchainInfo = await connection.getVersion();
      if (verbose) console.log('RPC Connection OK, Solana version:', blockchainInfo);
    } catch (error) {
      console.error('RPC Connection Test Failed:', error.message);
      spinner.fail('RPC endpoint is not responding correctly. Please check your configuration.');
      return { success: false, error: 'RPC connection failed' };
    }
    
    // Get token accounts for this public key
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(keypair.publicKey, {
      programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
    });
    
    // Find the specific token account
    const tokenAccount = tokenAccounts.value.find(
      account => account.account.data.parsed.info.mint === tokenAddress
    );
    
    if (!tokenAccount) {
      spinner.fail(`You don't own any tokens with address ${tokenAddress}`);
      return { success: false, error: 'Token not found in wallet' };
    }
    
    const tokenBalance = tokenAccount.account.data.parsed.info.tokenAmount.uiAmount;
    if (verbose) console.log(`Found token with balance: ${tokenBalance}`);
    
    if (tokenBalance <= 0) {
      spinner.fail(`You have 0 tokens with address ${tokenAddress}`);
      return { success: false, error: 'Token balance is 0' };
    }
    
    // Calculate actual amount to sell based on percentage
    const sellAmount = tokenBalance * (sellPercentage / 100);
    
    if (verbose) {
      console.log(`Selling ${sellAmount} tokens (${sellPercentage}% of ${tokenBalance})`);
    }
    
    // Initialize Jupiter API client
    if (verbose) console.log('Initializing Jupiter API client...');
    const jupiterQuoteApi = createJupiterApiClient();
    if (verbose) console.log('Jupiter API client initialized');
    
    // Calculate fee level
    let computeLimit;
    let selectedFeeType = options.feeType || config.defaultFee;
    
    // For selling, use a higher fee by default to ensure transaction success
    if (sellPercentage >= 50 && selectedFeeType === 'medium') {
      // Upgrade to high fee for important transactions
      selectedFeeType = 'high';
      if (verbose) console.log('Upgraded fee level to HIGH for large sell');
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
    
    // Get decimals from token account
    const tokenDecimals = tokenAccount.account.data.parsed.info.tokenAmount.decimals;
    // Convert to raw amount
    const rawAmount = Math.floor(sellAmount * Math.pow(10, tokenDecimals));
    
    // Get quotes with improved error handling
    if (verbose) {
      console.log('Requesting quote with params:', {
        inputMint: tokenAddress,
        outputMint: 'So11111111111111111111111111111111111111112', // SOL
        amount: rawAmount.toString(),
        slippageBps: config.slippage * 100
      });
    }
    
    let quoteResponse;
    try {
      // Request quote
      quoteResponse = await jupiterQuoteApi.quoteGet({
        inputMint: tokenAddress,
        outputMint: 'So11111111111111111111111111111111111111112', // SOL
        amount: rawAmount.toString(),
        slippageBps: config.slippage * 100 // Convert percentage to basis points
      }).catch(error => {
        if (verbose) console.error('Error fetching quotes:', error.response ? JSON.stringify(error.response.data) : error.message);
        return null;
      });
      
      if (verbose) {
        console.log('Quote response received:', quoteResponse ? 'yes' : 'no');
        if (quoteResponse) console.log('Quote response details:', JSON.stringify(quoteResponse, null, 2));
      }
      
      if (!quoteResponse) {
        spinner.fail('No quote response received from Jupiter');
        return { success: false, error: 'No quote response' };
      }
      
      // Extract route data based on API version
      let bestRoute;
      if (quoteResponse.data) {
        bestRoute = quoteResponse.data;
      } else {
        bestRoute = quoteResponse;
      }
      
      if (!bestRoute || !bestRoute.outAmount) {
        spinner.fail('Invalid quote response from Jupiter');
        return { success: false, error: 'Invalid quote response' };
      }
      
      if (verbose) console.log('Valid route found with outAmount:', bestRoute.outAmount);
      
      // Determine if we're using v6 API (check for routePlan field)
      const isV6Api = !!(bestRoute.routePlan || (bestRoute.routes && bestRoute.routes[0] && bestRoute.routes[0].routePlan));
      if (verbose) console.log(`Using Jupiter API V${isV6Api ? '6' : '5'}`);
      
      // Get swap instructions with better error handling
      let swapResponse;
      try {
        if (verbose) console.log('Requesting swap transaction...');
        
        // Try using v6 format first if detected
        if (isV6Api) {
          if (verbose) console.log('Attempting Jupiter V6 API format');
          swapResponse = await jupiterQuoteApi.swapPost({
            quoteResponse: bestRoute,
            userPublicKey: keypair.publicKey.toString(),
            wrapAndUnwrapSol: true
          }).catch(error => {
            if (verbose) console.error('V6 swap request failed:', error);
            return null;
          });
        }
        
        // Try V5 format if V6 didn't work or wasn't detected
        if (!swapResponse) {
          if (verbose) console.log('Attempting Jupiter V5 API format');
          swapResponse = await jupiterQuoteApi.swapPost({
            swapRequest: {
              quoteResponse: bestRoute,
              userPublicKey: keypair.publicKey.toString(),
              wrapUnwrapSOL: true
            }
          }).catch(error => {
            if (verbose) console.error('V5 format #1 failed:', error);
            return null;
          });
        }
        
        // If still failed, try alternative V5 format
        if (!swapResponse) {
          if (verbose) console.log('Attempting Jupiter API alternative format');
          swapResponse = await jupiterQuoteApi.swapPost({
            swapRequest: {
              route: bestRoute,
              userPublicKey: keypair.publicKey.toString(),
              wrapUnwrapSOL: true
            }
          }).catch(error => {
            if (verbose) console.error('Alternative format failed:', error);
            return null;
          });
        }
        
        if (verbose) console.log('Swap response received:', swapResponse ? 'yes' : 'no');
        if (verbose && swapResponse) console.log('Swap response:', JSON.stringify(swapResponse, null, 2));
        
        if (!swapResponse) {
          spinner.fail('Failed to get swap transaction after multiple attempts');
          return { success: false, error: 'Failed to get swap transaction' };
        }
      } catch (error) {
        console.error('Exception during swap request:', error);
        spinner.fail(`Error getting swap transaction: ${error.message}`);
        return { success: false, error: `Swap transaction error: ${error.message}` };
      }
      
      // Extract the swap transaction data from the response
      let swapTransactionData;
      if (swapResponse.swapTransaction) {
        swapTransactionData = swapResponse.swapTransaction;
      } else if (swapResponse.data && swapResponse.data.swapTransaction) {
        swapTransactionData = swapResponse.data.swapTransaction;
      } else {
        // Look deeper into the response to find the transaction
        if (verbose) console.log('Searching deeper for transaction data in response');
        if (swapResponse.data && typeof swapResponse.data === 'object') {
          for (const key in swapResponse.data) {
            if (typeof swapResponse.data[key] === 'string' && swapResponse.data[key].length > 100) {
              if (verbose) console.log(`Found potential transaction data in field: ${key}`);
              swapTransactionData = swapResponse.data[key];
              break;
            }
          }
        }
      }
      
      if (!swapTransactionData) {
        spinner.fail('No swap transaction data found in response');
        return { success: false, error: 'No swap transaction data' };
      }
      
      // Create transaction - TRY VERSIONED TRANSACTION FIRST
      if (verbose) console.log('Creating transaction...');
      const swapTransactionBuf = Buffer.from(swapTransactionData, 'base64');
      
      // FIRST TRY: Attempt as a versioned transaction
      try {
        if (verbose) console.log('Attempting versioned transaction format from Jupiter');
        
        // Use VersionedTransaction.deserialize to parse the transaction
        const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
        
        if (verbose) console.log('Successfully deserialized as versioned transaction with',
                               transaction.message.compiledInstructions.length, 'instructions');
        
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
        
        // Sign and send the versioned transaction
        if (verbose) console.log('Signing and sending versioned transaction...');
        
        // Sign the transaction with keypair
        transaction.sign([keypair]);
        
        const txid = await connection.sendTransaction(transaction, txOptions);
        if (verbose) console.log('Transaction sent with ID:', txid);
        
        // Wait for confirmation using our verification method
        spinner.text = 'Waiting for transaction confirmation...';
        
        const verificationResult = await verifyTransactionOnChain(connection, txid, 40, verbose);
        
        if (verificationResult.success) {
          // Calculate sold amount in SOL 
          const soldAmountSol = parseFloat(bestRoute.outAmount) / LAMPORTS_PER_SOL;
          
          spinner.succeed(`Successfully sold ${sellAmount.toLocaleString()} tokens for ${soldAmountSol.toFixed(4)} SOL!`);
          console.log(`Transaction ID: ${txid}`);
          console.log(`Note: Versioned transaction used default compute budget from Jupiter`);
          
          return {
            success: true,
            soldAmount: sellAmount,
            soldAmountSol,
            txid: txid,
            status: verificationResult.status
          };
        } else {
          spinner.fail(`Transaction failed: ${verificationResult.error}`);
          return { 
            success: false, 
            error: verificationResult.error, 
            txid: txid,
            status: verificationResult.status
          };
        }
      } catch (error) {
        // If versioned transaction deserialization fails, try legacy format as fallback
        if (verbose) {
          console.error('Versioned transaction deserialization failed:', error);
          console.log('Falling back to legacy transaction format...');
        }
        
        try {
          // Try legacy transaction format as a last resort
          const transaction = Transaction.from(swapTransactionBuf);
          if (verbose) console.log('Created legacy transaction with', transaction.instructions.length, 'instructions');
          
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
          
          // Send and confirm legacy transaction
          const txid = await sendAndConfirmTransaction(
            connection,
            transaction,
            [keypair],
            txOptions
          );
          
          if (verbose) console.log('Legacy transaction sent with ID:', txid);
          
          // Verify that the transaction is on chain and finalized
          spinner.text = 'Verifying transaction on chain...';
          
          const verificationResult = await verifyTransactionOnChain(connection, txid, 40, verbose);
          
          // Calculate priorityFee used
          const priorityFeeMicroLamports = config.priorityFeeMultiplier > 1 ? 
            Math.floor((computeLimit / 10) * config.priorityFeeMultiplier * (sellPercentage >= 75 ? 1.5 : 1.2)) : 0;
          
          if (verificationResult.success) {
            // Calculate sold amount in SOL 
            const soldAmountSol = parseFloat(bestRoute.outAmount) / LAMPORTS_PER_SOL;
            
            spinner.succeed(`Successfully sold ${sellAmount.toLocaleString()} tokens for ${soldAmountSol.toFixed(4)} SOL!`);
            console.log(`Transaction ID: ${txid}`);
            
            if (priorityFeeMicroLamports > 0) {
              console.log(`Priority Fee: ${priorityFeeMicroLamports} microLamports`);
            }
            console.log(`Compute Units: ${computeLimit}`);
            
            return {
              success: true,
              soldAmount: sellAmount,
              soldAmountSol,
              txid: txid,
              status: verificationResult.status
            };
          } else {
            spinner.fail(`Transaction failed: ${verificationResult.error}`);
            return { 
              success: false, 
              error: verificationResult.error, 
              txid: txid,
              status: verificationResult.status
            };
          }
        } catch (legacyError) {
          // Both versioned and legacy deserialization failed
          console.error('Legacy transaction deserialization also failed:', legacyError);
          spinner.fail(`Transaction deserialization failed: ${error.message}`);
          return { success: false, error: `Transaction deserialization failed: ${error.message}` };
        }
      }
    } catch (error) {
      console.error('Error in quote processing:', error);
      spinner.fail(`Quote processing error: ${error.message}`);
      return { success: false, error: `Quote error: ${error.message}` };
    }
  } catch (error) {
    spinner.fail(`Error selling token: ${error.message}`);
    console.error('Full error:', error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  sellToken
};
