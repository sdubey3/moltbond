// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title MoltBond
 * @notice Agent reputation staking + escrow system for AI agents.
 *         Agents stake USDC to build reputation, create escrow deals,
 *         and earn on-chain trust scores.
 */
contract MoltBond is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Types ───────────────────────────────────────────────────────
    enum DealStatus { Active, Completed, Disputed, Cancelled, Expired }

    struct Agent {
        string name;            // Moltbook/display name
        uint256 staked;         // USDC staked for reputation
        uint256 dealsCompleted; // successful deals
        uint256 dealsFailed;    // failed/disputed deals
        uint256 totalVolume;    // total USDC transacted
        uint256 registeredAt;
        bool exists;
    }

    struct Deal {
        uint256 id;
        address creator;        // agent who created the deal
        address counterparty;   // agent who accepts
        uint256 amount;         // USDC amount in escrow
        string description;     // what the deal is for
        DealStatus status;
        uint256 createdAt;
        uint256 expiresAt;      // auto-cancel after this
        bool creatorConfirmed;
        bool counterpartyConfirmed;
    }

    // ─── State ───────────────────────────────────────────────────────
    IERC20 public immutable usdc;
    
    mapping(address => Agent) public agents;
    address[] public agentList;
    
    Deal[] public deals;
    
    uint256 public constant MIN_STAKE = 1e6;        // 1 USDC (6 decimals)
    uint256 public constant UNSTAKE_COOLDOWN = 1 days;
    uint256 public constant DEFAULT_EXPIRY = 7 days;
    uint256 public constant SLASH_PERCENT = 10;      // 10% slash on failed deal
    
    mapping(address => uint256) public unstakeRequestedAt;

    // ─── Events ──────────────────────────────────────────────────────
    event AgentRegistered(address indexed agent, string name, uint256 timestamp);
    event Staked(address indexed agent, uint256 amount, uint256 totalStaked);
    event UnstakeRequested(address indexed agent, uint256 timestamp);
    event Unstaked(address indexed agent, uint256 amount, uint256 remaining);
    event DealCreated(uint256 indexed dealId, address indexed creator, address indexed counterparty, uint256 amount, string description);
    event DealAccepted(uint256 indexed dealId, address indexed counterparty);
    event DealCompleted(uint256 indexed dealId, uint256 timestamp);
    event DealDisputed(uint256 indexed dealId, address indexed disputedBy);
    event DealCancelled(uint256 indexed dealId);
    event DealExpired(uint256 indexed dealId);
    event Slashed(address indexed agent, uint256 amount, uint256 dealId);

    // ─── Constructor ─────────────────────────────────────────────────
    constructor(address _usdc) {
        require(_usdc != address(0), "Invalid USDC address");
        usdc = IERC20(_usdc);
    }

    // ─── Agent Management ────────────────────────────────────────────

    /// @notice Register as an agent with a display name
    function registerAgent(string calldata _name) external {
        require(!agents[msg.sender].exists, "Already registered");
        require(bytes(_name).length > 0 && bytes(_name).length <= 32, "Invalid name length");
        
        agents[msg.sender] = Agent({
            name: _name,
            staked: 0,
            dealsCompleted: 0,
            dealsFailed: 0,
            totalVolume: 0,
            registeredAt: block.timestamp,
            exists: true
        });
        agentList.push(msg.sender);
        
        emit AgentRegistered(msg.sender, _name, block.timestamp);
    }

    /// @notice Stake USDC to build reputation
    function stake(uint256 _amount) external nonReentrant {
        require(agents[msg.sender].exists, "Not registered");
        require(_amount >= MIN_STAKE, "Below minimum stake");
        
        usdc.safeTransferFrom(msg.sender, address(this), _amount);
        agents[msg.sender].staked += _amount;
        
        // Reset unstake cooldown
        unstakeRequestedAt[msg.sender] = 0;
        
        emit Staked(msg.sender, _amount, agents[msg.sender].staked);
    }

    /// @notice Request to unstake (starts cooldown)
    function requestUnstake() external {
        require(agents[msg.sender].exists, "Not registered");
        require(agents[msg.sender].staked > 0, "Nothing staked");
        
        unstakeRequestedAt[msg.sender] = block.timestamp;
        emit UnstakeRequested(msg.sender, block.timestamp);
    }

    /// @notice Withdraw staked USDC after cooldown
    function unstake(uint256 _amount) external nonReentrant {
        require(agents[msg.sender].exists, "Not registered");
        require(agents[msg.sender].staked >= _amount, "Insufficient stake");
        require(unstakeRequestedAt[msg.sender] > 0, "No unstake requested");
        require(
            block.timestamp >= unstakeRequestedAt[msg.sender] + UNSTAKE_COOLDOWN,
            "Cooldown not elapsed"
        );
        
        agents[msg.sender].staked -= _amount;
        usdc.safeTransfer(msg.sender, _amount);
        
        if (agents[msg.sender].staked == 0) {
            unstakeRequestedAt[msg.sender] = 0;
        }
        
        emit Unstaked(msg.sender, _amount, agents[msg.sender].staked);
    }

    // ─── Escrow ──────────────────────────────────────────────────────

    /// @notice Create an escrow deal with another agent
    function createDeal(
        address _counterparty,
        uint256 _amount,
        string calldata _description,
        uint256 _expiryDuration
    ) external nonReentrant returns (uint256 dealId) {
        require(agents[msg.sender].exists, "Creator not registered");
        require(agents[_counterparty].exists, "Counterparty not registered");
        require(msg.sender != _counterparty, "Cannot deal with self");
        require(_amount > 0, "Amount must be positive");
        
        uint256 expiry = _expiryDuration > 0 ? _expiryDuration : DEFAULT_EXPIRY;
        
        // Transfer USDC to escrow
        usdc.safeTransferFrom(msg.sender, address(this), _amount);
        
        dealId = deals.length;
        deals.push(Deal({
            id: dealId,
            creator: msg.sender,
            counterparty: _counterparty,
            amount: _amount,
            description: _description,
            status: DealStatus.Active,
            createdAt: block.timestamp,
            expiresAt: block.timestamp + expiry,
            creatorConfirmed: false,
            counterpartyConfirmed: false
        }));
        
        emit DealCreated(dealId, msg.sender, _counterparty, _amount, _description);
    }

    /// @notice Confirm deal completion (both parties must confirm)
    function confirmDeal(uint256 _dealId) external {
        require(_dealId < deals.length, "Deal not found");
        Deal storage deal = deals[_dealId];
        require(deal.status == DealStatus.Active, "Deal not active");
        require(
            msg.sender == deal.creator || msg.sender == deal.counterparty,
            "Not a party to this deal"
        );
        
        if (msg.sender == deal.creator) {
            deal.creatorConfirmed = true;
        } else {
            deal.counterpartyConfirmed = true;
        }
        
        // If both confirmed, complete the deal
        if (deal.creatorConfirmed && deal.counterpartyConfirmed) {
            _completeDeal(_dealId);
        }
    }

    /// @notice Dispute a deal (triggers slash on the other party)
    function disputeDeal(uint256 _dealId) external {
        require(_dealId < deals.length, "Deal not found");
        Deal storage deal = deals[_dealId];
        require(deal.status == DealStatus.Active, "Deal not active");
        require(
            msg.sender == deal.creator || msg.sender == deal.counterparty,
            "Not a party to this deal"
        );
        
        deal.status = DealStatus.Disputed;
        
        // Return escrowed funds to creator
        usdc.safeTransfer(deal.creator, deal.amount);
        
        // Slash the other party's stake
        address slashTarget = msg.sender == deal.creator ? deal.counterparty : deal.creator;
        uint256 slashAmount = (agents[slashTarget].staked * SLASH_PERCENT) / 100;
        if (slashAmount > 0) {
            agents[slashTarget].staked -= slashAmount;
            // Slashed funds go to the disputer as compensation
            usdc.safeTransfer(msg.sender, slashAmount);
            emit Slashed(slashTarget, slashAmount, _dealId);
        }
        
        // Update stats
        agents[slashTarget].dealsFailed += 1;
        
        emit DealDisputed(_dealId, msg.sender);
    }

    /// @notice Cancel an expired deal
    function cancelExpiredDeal(uint256 _dealId) external {
        require(_dealId < deals.length, "Deal not found");
        Deal storage deal = deals[_dealId];
        require(deal.status == DealStatus.Active, "Deal not active");
        require(block.timestamp >= deal.expiresAt, "Deal not expired");
        
        deal.status = DealStatus.Expired;
        
        // Return funds to creator
        usdc.safeTransfer(deal.creator, deal.amount);
        
        emit DealExpired(_dealId);
    }

    // ─── Internal ────────────────────────────────────────────────────

    function _completeDeal(uint256 _dealId) internal nonReentrant {
        Deal storage deal = deals[_dealId];
        deal.status = DealStatus.Completed;
        
        // Transfer funds to counterparty (they did the work)
        usdc.safeTransfer(deal.counterparty, deal.amount);
        
        // Update stats for both parties
        agents[deal.creator].dealsCompleted += 1;
        agents[deal.creator].totalVolume += deal.amount;
        agents[deal.counterparty].dealsCompleted += 1;
        agents[deal.counterparty].totalVolume += deal.amount;
        
        emit DealCompleted(_dealId, block.timestamp);
    }

    // ─── View Functions ──────────────────────────────────────────────

    /// @notice Get agent's reputation score (0-1000)
    function getReputation(address _agent) external view returns (uint256) {
        Agent storage a = agents[_agent];
        if (!a.exists) return 0;
        
        uint256 totalDeals = a.dealsCompleted + a.dealsFailed;
        if (totalDeals == 0) {
            // Base reputation from stake alone
            return _min((a.staked / 1e6) * 10, 200); // max 200 from stake alone
        }
        
        // Score components:
        // - Completion rate: up to 500 points
        // - Volume: up to 300 points  
        // - Stake: up to 200 points
        uint256 completionScore = (a.dealsCompleted * 500) / totalDeals;
        uint256 volumeScore = _min((a.totalVolume / 100e6) * 30, 300); // 30pts per 100 USDC, max 300
        uint256 stakeScore = _min((a.staked / 1e6) * 10, 200); // 10pts per USDC, max 200
        
        return completionScore + volumeScore + stakeScore;
    }

    /// @notice Get total number of agents
    function getAgentCount() external view returns (uint256) {
        return agentList.length;
    }

    /// @notice Get total number of deals
    function getDealCount() external view returns (uint256) {
        return deals.length;
    }

    /// @notice Get agent address by index
    function getAgentAt(uint256 _index) external view returns (address) {
        return agentList[_index];
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }
}
