// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "./ActionTypes.sol";

interface IAction {
    // DEPRECATED
    function perform(Action calldata action, ActionRuntimeParams calldata runtimeParams)
        external
        returns (uint256[] memory);
    
    // unpacks action and triggerdata and creates calldata of the callee
    // calls the function
    // returns (ActionResponse[]) if successful, else should revert    
    function perform_v2(Action calldata action, ActionRuntimeParams calldata runtimeParams)
        external
        returns (ActionResponse memory);
    
    // reverts if action fails to validate, otherwise returns true
    function validate(Action calldata action) external view returns (bool);
}