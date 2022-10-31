// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IOps {
    function createTask(
        address _execAddress,
        bytes4 _execSelector,
        address _resolverAddress,
        bytes calldata _resolverData
    ) external returns (bytes32 task);

    function cancelTask(bytes32 _taskId) external;

    function gelato() external view returns (address payable);
}
