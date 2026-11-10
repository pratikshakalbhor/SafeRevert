import { useReadContracts, useAccount } from 'wagmi';
import { isAddress, type Address } from 'viem';
import { erc20Abi } from '../lib/abi';
import { NATIVE_TOKEN_ADDRESS, type TokenInfo } from '../lib/types';
import { VAULT_ADDRESS } from '../lib/config';

export function useTokenInfo(tokenAddress: string | undefined) {
  const { address: userAddress } = useAccount();

  const isNative =
    !tokenAddress ||
    tokenAddress.toLowerCase() === NATIVE_TOKEN_ADDRESS.toLowerCase();

  const validTokenAddress =
    !isNative && isAddress(tokenAddress || '') ? (tokenAddress as Address) : undefined;

  const { data, isLoading, refetch } = useReadContracts({
    contracts: validTokenAddress
      ? [
          {
            address: validTokenAddress,
            abi: erc20Abi,
            functionName: 'symbol',
          },
          {
            address: validTokenAddress,
            abi: erc20Abi,
            functionName: 'name',
          },
          {
            address: validTokenAddress,
            abi: erc20Abi,
            functionName: 'decimals',
          },
          {
            address: validTokenAddress,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: userAddress ? [userAddress] : undefined,
          },
          {
            address: validTokenAddress,
            abi: erc20Abi,
            functionName: 'allowance',
            args: userAddress && VAULT_ADDRESS ? [userAddress, VAULT_ADDRESS] : undefined,
          },
        ]
      : [],
    query: {
      enabled: Boolean(validTokenAddress),
    },
  });

  if (isNative) {
    const nativeToken: TokenInfo = {
      address: NATIVE_TOKEN_ADDRESS,
      symbol: 'ETH',
      name: 'Ethereum',
      decimals: 18,
      isNative: true,
    };
    return {
      token: nativeToken,
      balance: undefined, // handled by useBalance for ETH
      allowance: undefined,
      isLoading: false,
      refetch,
    };
  }

  if (!validTokenAddress) {
    return {
      token: null,
      balance: undefined,
      allowance: undefined,
      isLoading: false,
      refetch,
    };
  }

  const [symbolResult, nameResult, decimalsResult, balanceResult, allowanceResult] =
    data || [];

  const symbol = (symbolResult?.result as string) || 'TOKEN';
  const name = (nameResult?.result as string) || 'ERC-20 Token';
  const decimals = Number(decimalsResult?.result ?? 18);
  const balance = balanceResult?.result !== undefined ? (balanceResult.result as bigint) : undefined;
  const allowance = allowanceResult?.result !== undefined ? (allowanceResult.result as bigint) : undefined;

  const tokenInfo: TokenInfo = {
    address: validTokenAddress,
    symbol,
    name,
    decimals,
    isNative: false,
  };

  return {
    token: tokenInfo,
    balance,
    allowance,
    isLoading,
    refetch,
  };
}
