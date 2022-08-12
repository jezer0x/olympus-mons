// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

// Import this file to use console.log
import "hardhat/console.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "./Utils.sol";
import "./Types.sol";
import "./REConstants.sol";
import "./actions/IAction.sol";
import "./triggers/ITrigger.sol";
import "./IAssetIO.sol";

contract RuleExecutor is IAssetIO, Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    event Created(bytes32 indexed ruleHash);
    event Activated(bytes32 indexed ruleHash);
    event Deactivated(bytes32 indexed ruleHash);
    event Cancelled(bytes32 indexed ruleHash);
    event Executed(bytes32 indexed ruleHash, address executor);
    event Redeemed(bytes32 indexed ruleHash);
    event CollateralAdded(bytes32 indexed ruleHash, uint256 amt);
    event CollateralReduced(bytes32 indexed ruleHash, uint256 amt);

    modifier onlyRuleOwner(bytes32 ruleHash) {
        require(rules[ruleHash].owner == msg.sender, "You're not the owner of this rule");
        _;
    }

    modifier ruleExists(bytes32 ruleHash) {
        require(rules[ruleHash].owner != address(0), "Rule not found!");
        _;
    }

    // hash -> Rule
    mapping(bytes32 => Rule) rules;

    mapping(address => bool) whitelistedActions;
    mapping(address => bool) whitelistedTriggers;
    bool _disableActionWhitelist = false;
    bool _disableTriggerWhitelist = false;

    modifier onlyWhitelist(Trigger[] calldata triggers, Action[] calldata actions) {
        if (!_disableTriggerWhitelist) {
            for (uint256 i = 0; i < triggers.length; i++) {
                require(whitelistedTriggers[triggers[i].callee], "Unauthorized trigger");
            }
        }

        if (!_disableActionWhitelist) {
            for (uint256 i = 0; i < actions.length; i++) {
                require(whitelistedActions[actions[i].callee], "Unauthorized action");
            }
        }
        _;
    }

    function addTriggerToWhitelist(address triggerAddr) external onlyOwner {
        whitelistedTriggers[triggerAddr] = true;
    }

    function addActionToWhitelist(address actionAddr) external onlyOwner {
        whitelistedActions[actionAddr] = true;
    }

    function removeTriggerFromWhitelist(address triggerAddr) external onlyOwner {
        whitelistedTriggers[triggerAddr] = false;
    }

    function removeActionFromWhitelist(address actionAddr) external onlyOwner {
        whitelistedActions[actionAddr] = false;
    }

    function disableTriggerWhitelist() external onlyOwner {
        _disableTriggerWhitelist = true;
    }

    function disableActionWhitelist() external onlyOwner {
        _disableActionWhitelist = true;
    }

    function enableTriggerWhitelist() external onlyOwner {
        _disableTriggerWhitelist = false;
    }

    function enableActionWhitelist() external onlyOwner {
        _disableActionWhitelist = false;
    }

    function pause() public onlyOwner {
        _pause();
    }

    function unpause() public onlyOwner {
        _unpause();
    }

    constructor() {}

    function getRule(bytes32 ruleHash) public view ruleExists(ruleHash) returns (Rule memory) {
        return rules[ruleHash];
    }

    function getInputToken(bytes32 ruleHash) public view ruleExists(ruleHash) returns (address) {
        return rules[ruleHash].actions[0].inputToken;
    }

    function getOutputToken(bytes32 ruleHash) public view ruleExists(ruleHash) returns (address) {
        Rule storage rule = rules[ruleHash];
        return rule.actions[rule.actions.length - 1].outputToken;
    }

    function redeemBalance(bytes32 ruleHash) external whenNotPaused onlyRuleOwner(ruleHash) nonReentrant {
        Rule storage rule = rules[ruleHash];
        require(rule.status == RuleStatus.EXECUTED, "Rule not executed yet!");
        Utils._send(rule.owner, rule.outputAmount, getOutputToken(ruleHash));
        emit Redeemed(ruleHash);
    }

    function addCollateral(bytes32 ruleHash, uint256 amount)
        external
        payable
        whenNotPaused
        onlyRuleOwner(ruleHash)
        nonReentrant
    {
        Rule storage rule = rules[ruleHash];
        require(
            rule.status == RuleStatus.ACTIVE || rule.status == RuleStatus.INACTIVE,
            "Can't add collateral to this rule"
        );

        require(amount > 0, "amount must be > 0");

        if (getInputToken(ruleHash) != REConstants.ETH) {
            rule.totalCollateralAmount = rule.totalCollateralAmount + amount;
            // must have been approved first
            IERC20(getInputToken(ruleHash)).safeTransferFrom(msg.sender, address(this), amount);
        } else {
            require(amount == msg.value, "amount must be the same as msg.value if sending ETH");
            rule.totalCollateralAmount = rule.totalCollateralAmount + msg.value;
        }
        emit CollateralAdded(ruleHash, amount);
    }

    function reduceCollateral(bytes32 ruleHash, uint256 amount)
        external
        whenNotPaused
        onlyRuleOwner(ruleHash)
        nonReentrant
    {
        Rule storage rule = rules[ruleHash];
        require(
            rule.status == RuleStatus.ACTIVE || rule.status == RuleStatus.INACTIVE,
            "Can't reduce collateral from this rule"
        );

        // Note: if totalCollateral = 0 and amount = 1; underflow will cause a revert, so we don't have to do an explicit require here.
        rule.totalCollateralAmount = rule.totalCollateralAmount - amount;

        if (getInputToken(ruleHash) != REConstants.ETH) {
            IERC20(getInputToken(ruleHash)).safeTransfer(msg.sender, amount);
        } else {
            payable(msg.sender).transfer(amount);
        }
        emit CollateralReduced(ruleHash, amount);
    }

    function increaseReward(bytes32 ruleHash) external payable whenNotPaused ruleExists(ruleHash) {
        Rule storage rule = rules[ruleHash];
        rule.reward += msg.value;
    }

    function createRule(Trigger[] calldata triggers, Action[] calldata actions)
        external
        payable
        whenNotPaused
        nonReentrant
        onlyWhitelist(triggers, actions)
        returns (bytes32)
    {
        bytes32 ruleHash = _getRuleHash(triggers, actions);
        Rule storage rule = rules[ruleHash];
        for (uint256 i = 0; i < triggers.length; i++) {
            require(ITrigger(triggers[i].callee).validate(triggers[i]), "Invalid trigger provided");
            rule.triggers.push(triggers[i]);
        }
        for (uint256 i = 0; i < actions.length; i++) {
            require(IAction(actions[i].callee).validate(actions[i]), "Invalid action provided");
            if (i != actions.length - 1) {
                require(
                    actions[i].outputToken == actions[i + 1].inputToken,
                    "check inputToken -> outputToken chain is valid"
                );
            }
            rule.actions.push(actions[i]);
        }
        require(rule.owner == address(0), "Rule already exists!");
        rule.owner = msg.sender;
        rule.status = RuleStatus.INACTIVE;
        rule.outputAmount = 0;
        rule.reward = msg.value;

        emit Created(ruleHash);
        return ruleHash;
    }

    /*
        Valid State Transitions: (from) => (to)

        ACTIVE => {active, inactive, cancelled}
        INACTIVE => {active, cancelled}
        EXECUTED => {}
        CANCELLED => {} 
    */
    function activateRule(bytes32 ruleHash) external whenNotPaused onlyRuleOwner(ruleHash) {
        require(rules[ruleHash].status == RuleStatus.INACTIVE);
        rules[ruleHash].status = RuleStatus.ACTIVE;
        emit Activated(ruleHash);
    }

    function deactivateRule(bytes32 ruleHash) external whenNotPaused onlyRuleOwner(ruleHash) {
        require(rules[ruleHash].status == RuleStatus.ACTIVE);
        rules[ruleHash].status = RuleStatus.INACTIVE;
        emit Deactivated(ruleHash);
    }

    function cancelRule(bytes32 ruleHash) external whenNotPaused onlyRuleOwner(ruleHash) nonReentrant {
        Rule storage rule = rules[ruleHash];
        require(rule.status == RuleStatus.ACTIVE || rule.status == RuleStatus.INACTIVE, "Can't cancel this rule");
        rule.status = RuleStatus.CANCELLED;
        Utils._send(rule.owner, rule.totalCollateralAmount, getInputToken(ruleHash));
        emit Cancelled(ruleHash);
    }

    function _getRuleHash(Trigger[] calldata triggers, Action[] calldata actions) private view returns (bytes32) {
        return keccak256(abi.encode(triggers, actions, msg.sender, block.timestamp));
    }

    // WARNING: only the last trigger's data gets sent back as triggerData
    function _checkTriggers(Trigger[] storage triggers) internal view returns (bool valid, uint256 triggerData) {
        for (uint256 i = 0; i < triggers.length; i++) {
            (valid, triggerData) = ITrigger(triggers[i].callee).check(triggers[i]);
            if (!valid) return (false, 0);
        }
        return (true, triggerData);
    }

    function checkRule(bytes32 ruleHash) external view returns (bool valid) {
        (valid, ) = _checkTriggers(rules[ruleHash].triggers);
    }

    function executeRule(bytes32 ruleHash) external whenNotPaused ruleExists(ruleHash) nonReentrant {
        Rule storage rule = rules[ruleHash];
        require(rule.status == RuleStatus.ACTIVE, "Rule is not active!");
        (bool valid, uint256 triggerData) = _checkTriggers(rule.triggers);
        require(valid, "One (or more) trigger(s) not satisfied");

        ActionRuntimeParams memory runtimeParams = ActionRuntimeParams({
            triggerData: triggerData,
            totalCollateralAmount: rule.totalCollateralAmount
        });

        uint256 output = 0;
        for (uint256 i = 0; i < rule.actions.length; i++) {
            Action storage action = rule.actions[i];
            if (action.inputToken != REConstants.ETH) {
                IERC20(action.inputToken).safeApprove(action.callee, runtimeParams.totalCollateralAmount);
                output = IAction(action.callee).perform(action, runtimeParams);
            } else {
                output = IAction(action.callee).perform{value: runtimeParams.totalCollateralAmount}(
                    action,
                    runtimeParams
                );
            }
            runtimeParams.totalCollateralAmount = output;
        }

        rule.outputAmount = output;
        rule.status = RuleStatus.EXECUTED;
        // We dont need to check sender here.
        // As long as the execution reaches this point, the reward is there
        // for the taking.
        // slither-disable-next-line arbitrary-send
        payable(msg.sender).transfer(rule.reward);
        emit Executed(ruleHash, msg.sender);
    }
}
