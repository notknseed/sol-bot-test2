// buyToken.js - Fixed version with proper connection handling
const { PublicKey, Keypair, Transaction, VersionedTransaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { ComputeBudgetProgram } = require('@solana/web3.js');
const { createJupiterApiClient } = require('@jup-ag/api');
const ora = require('ora');
const fs = require('fs');

// Import connection manager
const { getConnection, verifyTransactionOnChain } = require('./connectionManager');

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

// Buy token function
async function buyToken(keypair, tokenAddress, options = {}) {
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
    
    // Load config
    const config = loadConfig();
    
    // Calculate amount
    const amount = options.amount ? parseFloat(options.amount) : config.defaultBuyAmount;
    if (verbose) console.log('Buy amount (SOL):', amount);
    
    // Get connection for quotes and setup (confirmed commitment)
    // Use confirmed commitment for general setup and queries
    const connection = getConnection(false, 'config.json', 'confirmed');
    if (verbose) console.log('Using connection with confirmed commitment for setup');
    
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
        if (quoteResponse) console.log('Quote response details:', JSON.stringify(quoteResponse, null, 2));
      }
      
      if (!quoteResponse) {
        spinner.fail('No quote response received from Jupiter');
        return { success: false, error: 'No quote response' };
      }
      
      // Jupiter API might return different response structures
      // Extract the best route data from the response
      let bestRoute = quoteResponse;
      if (quoteResponse.data) {
        bestRoute = quoteResponse.data;
      }
      
      if (!bestRoute || !bestRoute.outAmount) {
        spinner.fail('Invalid quote response from Jupiter');
        return { success: false, error: 'Invalid quote response' };
      }
      
      if (verbose) console.log('Valid route found!');
      if (verbose) console.log('Selected best route with outAmount:', bestRoute.outAmount);
      
      // Get swap instructions with improved error handling
      if (verbose) console.log('Requesting swap transaction...');
      
      // Use the correct format for Jupiter API
      let swapResponse;
      try {
        if (verbose) console.log('Attempting Jupiter API - correct format');
        
        // This is the most likely format to work with current Jupiter API
        swapResponse = await jupiterQuoteApi.swapPost({
          swapRequest: {
            quoteResponse: bestRoute,
            userPublicKey: keypair.publicKey.toString(),
            wrapUnwrapSOL: true
          }
        }).catch(error => {
          if (verbose) console.error('First format failed:', error);
          return null;
        });
        
        // If first attempt failed, try alternative formats
        if (!swapResponse) {
          if (verbose) console.log('Attempting Jupiter API - alternative format #1');
          swapResponse = await jupiterQuoteApi.swapPost({
            swapRequest: {
              route: bestRoute,
              userPublicKey: keypair.publicKey.toString(),
              wrapUnwrapSOL: true
            }
          }).catch(error => {
            if (verbose) console.error('Alternative format #1 failed:', error);
            return null;
          });
        }
        
        // If still failed, try yet another format
        if (!swapResponse) {
          if (verbose) console.log('Attempting Jupiter API - alternative format #2');
          swapResponse = await jupiterQuoteApi.swapPost({
            route: bestRoute,
            userPublicKey: keypair.publicKey.toString(),
            wrapUnwrapSOL: true
          }).catch(error => {
            if (verbose) console.error('Alternative format #2 failed:', error);
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
      
      // Create transaction - FIX FOR VERSIONED TRANSACTIONS
      if (verbose) console.log('Creating transaction...');
      const swapTransactionBuf = Buffer.from(swapTransactionData, 'base64');
      
      // CRITICAL FIX: Use processed commitment for faster transaction confirmation
      // Get a new connection with processed commitment for sending transaction
      const txConnection = getConnection(false, 'config.json', 'processed');
      if (verbose) console.log('Using connection with processed commitment for transaction submission');
      
      // CRITICAL FIX: Always assume it's a versioned transaction when coming from Jupiter
      try {
        if (verbose) console.log('Assuming versioned transaction format from Jupiter');
        
        // Use VersionedTransaction.deserialize to parse the transaction
        const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
        
        if (verbose) console.log('Successfully deserialized as versioned transaction with', 
                                transaction.message.compiledInstructions.length, 'instructions');
        
        if (verbose) {
          console.log('Transaction uses default compute budget from Jupiter');
        }
        
        // Set transaction options
        const txOptions = config.antiMEV ? {
          skipPreflight: true,
          preflightCommitment: 'processed',
          maxRetries: 5  // Increased from 3 to 5
        } : {
          preflightCommitment: 'processed',  // Changed from 'confirmed' to 'processed'
          maxRetries: 5   // Increased from 3 to 5
        };
        if (verbose) console.log('Transaction options:', txOptions);
        
        // Sign and send the versioned transaction
        if (verbose) console.log('Signing and sending versioned transaction...');
        
        // Sign the transaction with keypair
        transaction.sign([keypair]);
        
        const txid = await txConnection.sendTransaction(transaction, txOptions);
        if (verbose) console.log('Transaction sent with ID:', txid);
        
        // Wait for confirmation using our safer verification method
        spinner.text = 'Waiting for transaction confirmation...';
        
        const verificationResult = await verifyTransactionOnChain(txid, 60, verbose);  // Increased timeout to 60
        
        if (verificationResult.success) {
          spinner.succeed(`Successfully bought tokens! Transaction finalized on chain.`);
          
          // Get token amount purchased (token balance change)
          let outputAmount = parseFloat(bestRoute.outAmount) / Math.pow(10, bestRoute.outputDecimals || 9);
          
          console.log(`Purchased approximately ${outputAmount.toLocaleString()} tokens for ${amount} SOL`);
          console.log(`Transaction ID: ${txid}`);
          
          return {
            success: true,
            txid: txid,
            amount: outputAmount,
            amountSol: amount,
            token: tokenAddress,
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
          
          // Set transaction options - IMPORTANT: Use processed commitment for sending
          const txOptions = config.antiMEV ? {
            skipPreflight: true,
            preflightCommitment: 'processed',
            maxRetries: 5
          } : {
            preflightCommitment: 'processed',
            maxRetries: 5
          };
          
          // Send transaction with processed commitment connection
          const txid = await sendAndConfirmTransaction(
            txConnection,
            transaction,
            [keypair],
            txOptions
          );
          
          if (verbose) console.log('Legacy transaction sent with ID:', txid);
          
          // Verify that the transaction is on chain and finalized
          spinner.text = 'Verifying transaction on chain...';
          
          const verificationResult = await verifyTransactionOnChain(txid, 60, verbose);
          
          if (verificationResult.success) {
            spinner.succeed(`Successfully bought tokens! Transaction finalized on chain.`);
            
            // Get token amount purchased (token balance change)
            let outputAmount = parseFloat(bestRoute.outAmount) / Math.pow(10, bestRoute.outputDecimals || 9);
            
            console.log(`Purchased approximately ${outputAmount.toLocaleString()} tokens for ${amount} SOL`);
            console.log(`Transaction ID: ${txid}`);
            
            if (config.priorityFeeMultiplier > 1) {
              console.log(`Priority Fee: ${Math.floor((computeLimit / 10) * config.priorityFeeMultiplier)} microLamports`);
            }
            console.log(`Compute Units: ${computeLimit}`);
            
            return {
              success: true,
              txid: txid,
              amount: outputAmount,
              amountSol: amount,
              token: tokenAddress,
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
    spinner.fail(`Error buying token: ${error.message}`);
    console.error('Full error:', error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  buyToken
};
