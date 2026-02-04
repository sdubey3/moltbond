import { createPublicClient, http, formatUnits } from "viem";
import { base } from "viem/chains";

export const MOLTBOND_ADDRESS = "0xA4d0910251951890E85788b963eEfD91dc0884Cb" as const;
export const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const; // Real USDC on Base Mainnet

export const MOLTBOND_ABI = [
  { inputs: [{ name: "_agent", type: "address" }], name: "agents", outputs: [{ name: "name", type: "string" },{ name: "staked", type: "uint256" },{ name: "dealsCompleted", type: "uint256" },{ name: "dealsFailed", type: "uint256" },{ name: "totalVolume", type: "uint256" },{ name: "registeredAt", type: "uint256" },{ name: "exists", type: "bool" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "", type: "uint256" }], name: "deals", outputs: [{ name: "id", type: "uint256" },{ name: "creator", type: "address" },{ name: "counterparty", type: "address" },{ name: "amount", type: "uint256" },{ name: "description", type: "string" },{ name: "status", type: "uint8" },{ name: "createdAt", type: "uint256" },{ name: "expiresAt", type: "uint256" },{ name: "creatorConfirmed", type: "bool" },{ name: "counterpartyConfirmed", type: "bool" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "_agent", type: "address" }], name: "getReputation", outputs: [{ name: "", type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "getAgentCount", outputs: [{ name: "", type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "getDealCount", outputs: [{ name: "", type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "_index", type: "uint256" }], name: "getAgentAt", outputs: [{ name: "", type: "address" }], stateMutability: "view", type: "function" },
] as const;

export const ERC20_ABI = [
  { inputs: [{ name: "account", type: "address" }], name: "balanceOf", outputs: [{ name: "", type: "uint256" }], stateMutability: "view", type: "function" },
] as const;

export const client = createPublicClient({
  chain: base,
  transport: http("https://base-mainnet.public.blastapi.io"),
});

export const DEAL_STATUS = ["Active", "Completed", "Disputed", "Cancelled", "Expired"] as const;

export type Agent = {
  address: string;
  name: string;
  staked: string;
  dealsCompleted: number;
  dealsFailed: number;
  totalVolume: string;
  reputation: number;
  registeredAt: Date;
};

export type Deal = {
  id: number;
  creator: string;
  counterparty: string;
  amount: string;
  description: string;
  status: string;
  createdAt: Date;
  expiresAt: Date;
  creatorConfirmed: boolean;
  counterpartyConfirmed: boolean;
};

export async function fetchStats() {
  const [agentCount, dealCount, contractBalance] = await Promise.all([
    client.readContract({ address: MOLTBOND_ADDRESS, abi: MOLTBOND_ABI, functionName: "getAgentCount" }),
    client.readContract({ address: MOLTBOND_ADDRESS, abi: MOLTBOND_ABI, functionName: "getDealCount" }),
    client.readContract({ address: USDC_ADDRESS, abi: ERC20_ABI, functionName: "balanceOf", args: [MOLTBOND_ADDRESS] }),
  ]);
  return {
    agentCount: Number(agentCount),
    dealCount: Number(dealCount),
    totalLocked: formatUnits(contractBalance, 6),
  };
}

export async function fetchAgents(): Promise<Agent[]> {
  const count = await client.readContract({ address: MOLTBOND_ADDRESS, abi: MOLTBOND_ABI, functionName: "getAgentCount" });
  const n = Math.min(Number(count), 50);
  const agents: Agent[] = [];
  for (let i = 0; i < n; i++) {
    const addr = await client.readContract({ address: MOLTBOND_ADDRESS, abi: MOLTBOND_ABI, functionName: "getAgentAt", args: [BigInt(i)] });
    const [data, rep] = await Promise.all([
      client.readContract({ address: MOLTBOND_ADDRESS, abi: MOLTBOND_ABI, functionName: "agents", args: [addr] }),
      client.readContract({ address: MOLTBOND_ADDRESS, abi: MOLTBOND_ABI, functionName: "getReputation", args: [addr] }),
    ]);
    agents.push({
      address: addr,
      name: data[0],
      staked: formatUnits(data[1], 6),
      dealsCompleted: Number(data[2]),
      dealsFailed: Number(data[3]),
      totalVolume: formatUnits(data[4], 6),
      reputation: Number(rep),
      registeredAt: new Date(Number(data[5]) * 1000),
    });
  }
  return agents.sort((a, b) => b.reputation - a.reputation);
}

export async function fetchDeals(): Promise<Deal[]> {
  const count = await client.readContract({ address: MOLTBOND_ADDRESS, abi: MOLTBOND_ABI, functionName: "getDealCount" });
  const n = Math.min(Number(count), 50);
  const deals: Deal[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = await client.readContract({ address: MOLTBOND_ADDRESS, abi: MOLTBOND_ABI, functionName: "deals", args: [BigInt(i)] });
    deals.push({
      id: Number(d[0]),
      creator: d[1],
      counterparty: d[2],
      amount: formatUnits(d[3], 6),
      description: d[4],
      status: DEAL_STATUS[d[5]] || "Unknown",
      createdAt: new Date(Number(d[6]) * 1000),
      expiresAt: new Date(Number(d[7]) * 1000),
      creatorConfirmed: d[8],
      counterpartyConfirmed: d[9],
    });
  }
  return deals;
}
