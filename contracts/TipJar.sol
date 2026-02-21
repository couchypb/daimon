// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title TipJar
 * @notice Simple tipping contract for the Daimon network
 * @dev Anyone can tip any address. Recipients withdraw their balance.
 */
contract TipJar {
    // Reference to DaimonNetwork registry (optional verification)
    address public immutable daimonNetwork;
    
    // Balances for each recipient
    mapping(address => uint256) public balances;
    
    // Events
    event Tipped(address indexed from, address indexed to, uint256 amount);
    event Withdrawn(address indexed by, uint256 amount);
    
    constructor(address _daimonNetwork) {
        daimonNetwork = _daimonNetwork;
    }
    
    /**
     * @notice Tip an address
     * @param recipient The address to tip
     */
    function tip(address recipient) external payable {
        require(msg.value > 0, "TipJar: must send ETH");
        balances[recipient] += msg.value;
        emit Tipped(msg.sender, recipient, msg.value);
    }
    
    /**
     * @notice Tip multiple addresses at once
     * @param recipients Array of addresses to tip
     * @param amounts Array of amounts (must sum to msg.value)
     */
    function tipMultiple(address[] calldata recipients, uint256[] calldata amounts) external payable {
        require(recipients.length == amounts.length, "TipJar: length mismatch");
        
        uint256 total;
        for (uint256 i = 0; i < amounts.length; i++) {
            require(amounts[i] > 0, "TipJar: amount must be > 0");
            balances[recipients[i]] += amounts[i];
            emit Tipped(msg.sender, recipients[i], amounts[i]);
            total += amounts[i];
        }
        require(total == msg.value, "TipJar: total mismatch");
    }
    
    /**
     * @notice Withdraw your tips
     */
    function withdraw() external {
        uint256 amount = balances[msg.sender];
        require(amount > 0, "TipJar: no balance");
        balances[msg.sender] = 0;
        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "TipJar: withdrawal failed");
        emit Withdrawn(msg.sender, amount);
    }
    
    /**
     * @notice Check balance for an address
     */
    function balanceOf(address recipient) external view returns (uint256) {
        return balances[recipient];
    }
    
    /**
     * @notice Receive ETH directly (tips to contract owner)
     */
    receive() external payable {
        // Direct sends go to contract balance but don't credit anyone
        // This is intentional - use tip() function instead
    }
}