// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;
import "./RETypes.sol"; 

interface IAction {
    // unpacks action and triggerdata and creates calldata of the callee
    // calls the function
    // returns (success, uint) 
    function performAction(RETypes.Action memory action, RETypes.ActionRuntimeParams memory runtimeParams) external returns (bool, uint); 

    // reverts if action fails to validate 
    function validateAction(RETypes.Action memory action) external view; 
}