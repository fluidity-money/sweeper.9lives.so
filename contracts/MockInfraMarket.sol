// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../contracts/IInfraMarket.sol";
import "forge-std/console.sol";

contract MockInfraMarket is IInfraMarket {
    struct EpochDetails {
        uint64 campaign_when_whinged;
        bytes8 campaign_whinger_preferred_winner;
        address campaign_who_whinged;
        mapping(address => bytes32) commitments;
        mapping(address => bytes8) reveals;
        uint256 global_vested_arb;
        mapping(bytes8 => uint256) outcome_vested_arb;
        mapping(address => uint256) user_vested_arb;
        bool campaign_winner_set;
        bytes8 campaign_winner;
        address campaign_who_called;
        bytes8 campaign_what_called;
        uint64 campaign_when_called;
        uint256 redeemable_pot_existing;
        uint256 redeemable_pot_outstanding;
        mapping(address => bool) redeemable_user_has_claimed;
    }

    // Storage layout matching Rust implementation
    bool public created;
    bool public enabled;
    uint256 public dao_money;

    mapping(address => uint64) public campaign_call_begins;
    mapping(address => bytes32) public campaign_desc;
    mapping(address => uint64) public campaign_call_deadline;
    mapping(address => bool) public campaign_has_escaped;
    mapping(address => uint256) public cur_epochs;
    mapping(address => mapping(uint256 => EpochDetails)) public epochs;

    // Constants from original implementation
    uint256 public constant BOND_FOR_CALL = 2e18; // $2 fUSDC
    uint256 public constant BOND_FOR_WHINGE = 7e18; // $7 fUSDC
    uint256 public constant TWO_DAYS = 2 days;
    uint256 public constant FOUR_DAYS = 4 days;
    uint256 public constant A_WEEK_SECS = 7 days;
    uint256 public constant FEE_POT_INFRA_PCT = 100; // 1%
    uint256 public constant FEE_SCALING = 10000;
    uint256 public constant INCENTIVE_AMT_CALL = 2e18;
    uint256 public constant INCENTIVE_AMT_CLOSE = 1e18;
    uint256 public constant INCENTIVE_AMT_DECLARE = 3e18;

    function ctor(address, address, address, address, address) external {
        require(!created, "Already constructed");
        created = true;
        enabled = true;
        emit InfraMarketEnabled(true);
    }

    function enable_contract() external pure returns (bool) {
        return true;
    }

    function register(
        address trading_addr,
        bytes32 desc,
        uint64 launch_ts,
        uint64 call_deadline_ts
    ) external returns (uint256) {
        require(enabled, "Not enabled");
        require(
            campaign_call_deadline[trading_addr] == 0,
            "Already registered"
        );
        require(call_deadline_ts > 0, "Zero call deadline");
        require(trading_addr != address(0), "Zero trading addr");
        require(desc != bytes32(0), "Zero desc");

        campaign_call_begins[trading_addr] = launch_ts;
        campaign_desc[trading_addr] = desc;
        campaign_call_deadline[trading_addr] = call_deadline_ts;

        uint256 incentive_amts = INCENTIVE_AMT_CALL +
            INCENTIVE_AMT_CLOSE +
            INCENTIVE_AMT_DECLARE;
        dao_money += incentive_amts;

        emit MarketCreated2(
            msg.sender,
            trading_addr,
            desc,
            launch_ts,
            call_deadline_ts
        );
        return incentive_amts;
    }

    // Remaining functions implemented with similar pattern...
    // [Rest of the interface functions would be implemented here following the same pattern]

    function winner(address trading) external view override returns (bytes8) {
        return epochs[trading][cur_epochs[trading]].campaign_winner;
    }

    function status(
        address tradingAddr
    ) external view returns (InfraMarketState, uint64) {
        require(enabled, "Not enabled");
        require(campaign_call_deadline[tradingAddr] != 0, "Not registered");

        EpochDetails storage e = epochs[tradingAddr][cur_epochs[tradingAddr]];
        uint64 _now = uint64(block.timestamp);

        if (_now < campaign_call_begins[tradingAddr]) {
            return (InfraMarketState.Callable, 0);
        }

        if (e.campaign_when_called == 0) {
            uint64 deadline = campaign_call_deadline[tradingAddr];
            return (
                InfraMarketState.Callable,
                deadline > _now ? deadline - _now : 0
            );
        }

        if (_now <= e.campaign_when_called + TWO_DAYS) {
            return (
                InfraMarketState.Whinging,
                uint64(e.campaign_when_called + TWO_DAYS - _now)
            );
        }

        if (e.campaign_when_whinged == 0) {
            return (InfraMarketState.Closable, 0);
        }

        if (
            _now > e.campaign_when_called + TWO_DAYS &&
            e.campaign_who_whinged == address(0)
        ) {
            return (InfraMarketState.Closed, 0);
        }

        if (_now <= e.campaign_when_whinged + TWO_DAYS) {
            return (
                InfraMarketState.Predicting,
                uint64(e.campaign_when_whinged + TWO_DAYS - _now)
            );
        }

        if (_now <= e.campaign_when_whinged + FOUR_DAYS) {
            return (
                InfraMarketState.Revealing,
                uint64(e.campaign_when_whinged + FOUR_DAYS - _now)
            );
        }

        if (!e.campaign_winner_set) {
            return (InfraMarketState.Declarable, 0);
        }

        return (InfraMarketState.Sweeping, 0);
    }

    function curOutcomeVestedArb(
        address trading,
        bytes8 outcome
    ) external view override returns (uint256) {}

    function reveal(
        address tradingAddr,
        address committerAddr,
        bytes8 outcome,
        uint256 seed
    ) external override {
        require(enabled, "Not enabled");
        EpochDetails storage e = epochs[tradingAddr][cur_epochs[tradingAddr]];

        require(
            block.timestamp > e.campaign_when_whinged + TWO_DAYS &&
                block.timestamp <= e.campaign_when_whinged + FOUR_DAYS,
            "Not in reveal period"
        );

        require(e.reveals[committerAddr] == 0, "Already revealed");
        bytes32 commit = keccak256(
            abi.encodePacked(committerAddr, outcome, seed)
        );
        require(e.commitments[committerAddr] == commit, "Commit mismatch");

        e.reveals[committerAddr] = outcome;

        emit CommitmentRevealed(
            tradingAddr,
            committerAddr,
            outcome,
            msg.sender,
            1e18
        );

        // Mock vested ARB tracking - actual implementation would interact with token contracts
        uint256 mockVested = 1e18; // Simplified for mock
        e.global_vested_arb += mockVested;
        e.outcome_vested_arb[outcome] += mockVested;
        e.user_vested_arb[committerAddr] = mockVested;
    }

    function sweep(
        address tradingAddr,
        uint256 epochNo,
        address victim,
        address
    ) external override returns (uint256) {
        require(enabled, "Not enabled");
        EpochDetails storage e = epochs[tradingAddr][epochNo];

        require(e.user_vested_arb[victim] > 0, "Invalid victim");
        require(e.reveals[victim] != e.campaign_winner, "Correct bet");

        // Mock slashing logic
        uint256 slashed = e.user_vested_arb[victim];
        e.redeemable_pot_existing += slashed;
        e.redeemable_pot_outstanding += slashed;

        // Mock fee calculation (1%)
        uint256 fee = (slashed * FEE_POT_INFRA_PCT) / FEE_SCALING;

        // Adding mock logic for multiple victims
        if (e.redeemable_pot_existing == 0) {
            e.redeemable_pot_existing = 1000e18; // Mock value for tests
        }

        return fee;
    }

    function capture(
        address tradingAddr,
        uint256 epochNo,
        address
    ) external override returns (uint256) {
        require(enabled, "Not enabled");
        EpochDetails storage e = epochs[tradingAddr][epochNo];

        require(e.reveals[msg.sender] == e.campaign_winner, "Not winner");
        require(!e.redeemable_user_has_claimed[msg.sender], "Already claimed");

        // Mock: Return 50% of existing pool
        uint256 payout = e.redeemable_pot_existing / 2;
        e.redeemable_pot_existing -= payout;
        e.redeemable_pot_outstanding -= payout;
        e.redeemable_user_has_claimed[msg.sender] = true;
        return payout;
    }

    function escape(address tradingAddr) external override {
        require(enabled, "Not enabled");

        require(
            block.timestamp > campaign_call_deadline[tradingAddr],
            "Deadline not passed"
        );
        require(!campaign_has_escaped[tradingAddr], "Already escaped");

        campaign_has_escaped[tradingAddr] = true;
        emit CampaignEscaped(tradingAddr);
    }

    function startTs(address trading) external view override returns (uint64) {}

    function endTs(address trading) external view override returns (uint64) {}

    function declare(
        address tradingAddr,
        bytes8[] calldata outcomes,
        address
    ) external override returns (uint256) {
        require(enabled, "Not enabled");
        EpochDetails storage e = epochs[tradingAddr][cur_epochs[tradingAddr]];

        require(
            block.timestamp > e.campaign_when_whinged + FOUR_DAYS,
            "Not ready to declare"
        );
        require(!e.campaign_winner_set, "Winner already set");

        bytes8 finalWinner;
        if (outcomes.length > 0) {
            finalWinner = outcomes[0];
        } else {
            finalWinner = e.campaign_whinger_preferred_winner;
        }

        e.campaign_winner = finalWinner;
        e.campaign_winner_set = true;

        // Mock incentives transfer
        uint256 incentives = INCENTIVE_AMT_DECLARE;
        if (dao_money >= incentives) {
            dao_money -= incentives;
        }

        return incentives;
    }

    function epochNumber(
        address trading
    ) external view override returns (uint256 epochNo) {
        return cur_epochs[trading];
    }

    function enable_contract(bool status1) external override returns (bool) {
        enabled = status1;
        emit InfraMarketEnabled(status1);
        return true;
    }

    function call(
        address tradingAddr,
        bytes8 winner0,
        address incentiveRecipient
    ) external override returns (uint256) {
        console.log("call");
        console.log("now", block.timestamp);
        console.log("begins", campaign_call_begins[tradingAddr]);
        console.log("ends", campaign_call_deadline[tradingAddr]);

        require(enabled, "Not enabled");
        require(campaign_call_deadline[tradingAddr] != 0, "Not registered");
        require(
            block.timestamp > campaign_call_begins[tradingAddr],
            "Not inside calling period"
        );

        require(
            block.timestamp < campaign_call_deadline[tradingAddr],
            "Past deadline"
        );
        require(winner0 != 0, "Bad winner");

        uint256 curEpoch = cur_epochs[tradingAddr];
        EpochDetails storage e = epochs[tradingAddr][curEpoch];

        if (e.campaign_winner_set && e.campaign_winner == 0) {
            cur_epochs[tradingAddr]++;
            curEpoch = cur_epochs[tradingAddr];
            e = epochs[tradingAddr][curEpoch];
        }

        require(e.campaign_who_called == address(0), "Campaign already called");

        incentiveRecipient = incentiveRecipient != address(0)
            ? incentiveRecipient
            : msg.sender;
        e.campaign_when_called = uint64(block.timestamp);
        e.campaign_who_called = incentiveRecipient;
        e.campaign_what_called = winner0;

        emit CallMade(tradingAddr, winner0, incentiveRecipient);
        return BOND_FOR_CALL;
    }

    function close(
        address tradingAddr,
        address feeRecipient
    ) external override {
        require(enabled, "Not enabled");
        EpochDetails storage e = epochs[tradingAddr][cur_epochs[tradingAddr]];

        require(campaign_call_deadline[tradingAddr] != 0, "Not registered");
        require(e.campaign_who_whinged == address(0), "Someone whinged");
        require(
            block.timestamp > e.campaign_when_called + TWO_DAYS,
            "Not after whinging"
        );
        require(e.campaign_who_called != address(0), "Campaign zero caller");
        require(!e.campaign_winner_set, "Winner already declared");

        feeRecipient = feeRecipient != address(0) ? feeRecipient : msg.sender;

        if (dao_money >= INCENTIVE_AMT_CLOSE && cur_epochs[tradingAddr] == 0) {
            dao_money -= INCENTIVE_AMT_CLOSE;
        }

        e.campaign_winner = e.campaign_what_called;
        e.campaign_winner_set = true;

        emit InfraMarketClosed(
            feeRecipient,
            tradingAddr,
            e.campaign_what_called
        );
    }

    function whinge(
        address tradingAddr,
        bytes8 preferredOutcome,
        address bondRecipient
    ) external override returns (uint256) {
        require(enabled, "Not enabled");
        require(campaign_call_deadline[tradingAddr] != 0, "Not registered");

        bondRecipient = bondRecipient != address(0)
            ? bondRecipient
            : msg.sender;
        EpochDetails storage e = epochs[tradingAddr][cur_epochs[tradingAddr]];

        require(
            block.timestamp > e.campaign_when_called &&
                block.timestamp <= e.campaign_when_called + TWO_DAYS,
            "Not in whinging period"
        );
        require(
            preferredOutcome != e.campaign_what_called,
            "Can't whinge called"
        );
        require(preferredOutcome != 0, "Preferred outcome zero");
        require(e.campaign_who_whinged == address(0), "Already whinged");

        e.campaign_who_whinged = bondRecipient;
        e.campaign_when_whinged = uint64(block.timestamp);
        e.campaign_whinger_preferred_winner = preferredOutcome;

        return BOND_FOR_WHINGE;
    }

    function predict(address tradingAddr, bytes32 commit) external override {
        require(enabled, "Not enabled");
        require(campaign_call_deadline[tradingAddr] != 0, "Not registered");
        EpochDetails storage e = epochs[tradingAddr][cur_epochs[tradingAddr]];

        require(
            block.timestamp > e.campaign_when_whinged &&
                block.timestamp <= e.campaign_when_whinged + TWO_DAYS,
            "Predicting not started"
        );

        require(e.commitments[msg.sender] == 0, "Already committed");
        require(commit != 0, "Zero commit");

        e.commitments[msg.sender] = commit;

        emit Committed(tradingAddr, msg.sender, commit);
    }
}
